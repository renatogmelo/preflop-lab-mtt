use std::collections::HashMap;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const MAGIC: &[u8; 8] = b"PLR61101";
const VERSION: u32 = 1;
const HEADER_BYTES: usize = 72;
const FNV_OFFSET: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

#[derive(Clone, Debug)]
struct Configuration {
    id: String,
    private_states: u32,
    public_signals: u32,
    stages: u32,
    actions: u32,
    seed: u32,
    dependency: String,
}

#[derive(Clone, Copy, Debug)]
enum LevelKind {
    Root,
    Decision,
    Chance,
    Terminal,
}

#[derive(Clone, Copy, Debug)]
struct Level {
    kind: LevelKind,
    stage: i32,
    offset: usize,
    count: usize,
}

#[derive(Debug)]
struct Compiled {
    levels: Vec<Level>,
    kind: Vec<u8>,
    actor: Vec<i8>,
    first_child: Vec<u32>,
    child_count: Vec<u16>,
    information_set: Vec<i32>,
    edge_probability: Vec<f64>,
    terminal_p0: Vec<f64>,
    information_set_action_offset: Vec<u32>,
    information_set_action_count: Vec<u16>,
    terminals: u32,
    chance_nodes: u32,
    decision_nodes: u32,
    maximum_depth: u32,
    total_information_set_actions: u32,
}

fn checked_pow(base: usize, exponent: u32, label: &str) -> Result<usize, String> {
    let mut result = 1usize;
    for _ in 0..exponent {
        result = result
            .checked_mul(base)
            .ok_or_else(|| format!("{label} overflow"))?;
    }
    Ok(result)
}

fn geometric_sum(base: usize, terms: u32) -> Result<usize, String> {
    let mut sum = 0usize;
    let mut power = 1usize;
    for _ in 0..terms {
        sum = sum.checked_add(power).ok_or("geometric sum overflow")?;
        power = power.checked_mul(base).ok_or("geometric power overflow")?;
    }
    Ok(sum)
}

fn seeded_unit(seed: u32, label: &str) -> f64 {
    let mut state = seed;
    for code_unit in label.encode_utf16() {
        state ^= u32::from(code_unit);
        state = state.wrapping_mul(0x0100_0193);
    }
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    f64::from(state) / 4_294_967_296.0
}

fn history_digits(mut history: usize, stages: u32, branching: usize) -> Vec<usize> {
    let mut digits = vec![0usize; stages as usize];
    for index in (0..digits.len()).rev() {
        digits[index] = history % branching;
        history /= branching;
    }
    digits
}

fn history_label(digits: &[usize], public_signals: usize) -> String {
    let mut result = String::new();
    for (stage, digit) in digits.iter().enumerate() {
        if !result.is_empty() {
            result.push('|');
        }
        result.push_str(&format!(
            "a{}:{}|s{}:{}",
            stage,
            digit / public_signals,
            stage,
            digit % public_signals
        ));
    }
    result
}

fn terminal_utility(
    config: &Configuration,
    state: usize,
    terminal_offset: usize,
) -> Result<f64, String> {
    let branching = (config.actions as usize)
        .checked_mul(config.public_signals as usize)
        .ok_or("branching overflow")?;
    let histories = checked_pow(branching, config.stages, "terminal histories")?;
    let ordinal = state - terminal_offset;
    let deal = ordinal / histories;
    let history_code = ordinal % histories;
    let first = deal / config.private_states as usize;
    let second = deal % config.private_states as usize;
    let digits = history_digits(history_code, config.stages, branching);
    let denominator = usize::max(1, config.private_states as usize - 1) as f64;
    let mut value = (first as f64 - second as f64) / denominator;
    if config.dependency != "independent" {
        for (stage, digit) in digits.iter().enumerate() {
            let action = digit / config.public_signals as usize;
            let actor = stage % 2;
            let private_state = if actor == 0 { first } else { second };
            let aligned = action == private_state % config.actions as usize;
            value += if actor == 0 { 1.0 } else { -1.0 } * if aligned { 0.45 } else { -0.12 };
        }
    }
    if config.dependency == "history-coupled" {
        for (stage, digit) in digits.iter().enumerate() {
            let signal = digit % config.public_signals as usize;
            value += if stage.is_multiple_of(2) { 1.0 } else { -1.0 }
                * (signal as f64 - (config.public_signals as f64 - 1.0) / 2.0)
                * 0.08;
        }
    }
    let label = history_label(&digits, config.public_signals as usize);
    value += (seeded_unit(config.seed, &format!("utility|{first}|{second}|{label}")) - 0.5) * 0.02;
    Ok(value.tanh())
}

fn chance_weights(
    config: &Configuration,
    state: usize,
    level_offset: usize,
    stage: u32,
) -> Result<Vec<u16>, String> {
    let branching = (config.actions as usize)
        .checked_mul(config.public_signals as usize)
        .ok_or("branching overflow")?;
    let decision_ordinal = (state - level_offset) / config.actions as usize;
    let action = (state - level_offset) % config.actions as usize;
    let histories = checked_pow(branching, stage, "chance histories")?;
    let deal = decision_ordinal / histories;
    let history = decision_ordinal % histories;
    let first = deal / config.private_states as usize;
    let second = deal % config.private_states as usize;
    let prefix = history_label(
        &history_digits(history, stage, branching),
        config.public_signals as usize,
    );
    let label = if prefix.is_empty() {
        format!("{first}|{second}|a{stage}:{action}")
    } else {
        format!("{first}|{second}|{prefix}|a{stage}:{action}")
    };
    Ok((0..config.public_signals)
        .map(|signal| {
            1 + (seeded_unit(config.seed, &format!("{label}|{signal}")) * 9.0).floor() as u16
        })
        .collect())
}

fn compile(config: &Configuration) -> Result<Compiled, String> {
    if config.private_states < 1
        || config.public_signals < 1
        || config.stages < 1
        || config.actions < 2
    {
        return Err("dimensions are outside the supported range".into());
    }
    if config.actions > u16::MAX as u32 {
        return Err("action count exceeds u16 capacity".into());
    }
    let private_deals = checked_pow(config.private_states as usize, 2, "private deals")?;
    if private_deals > u16::MAX as usize {
        return Err("root chance actions exceed u16 capacity".into());
    }
    let branching = (config.actions as usize)
        .checked_mul(config.public_signals as usize)
        .ok_or("branching overflow")?;
    let histories = geometric_sum(branching, config.stages)?;
    let decision_nodes = private_deals
        .checked_mul(histories)
        .ok_or("decision nodes overflow")?;
    let chance_after = decision_nodes
        .checked_mul(config.actions as usize)
        .ok_or("chance nodes overflow")?;
    let terminals = private_deals
        .checked_mul(checked_pow(branching, config.stages, "terminal nodes")?)
        .ok_or("terminal nodes overflow")?;
    let nodes = 1usize
        .checked_add(decision_nodes)
        .and_then(|v| v.checked_add(chance_after))
        .and_then(|v| v.checked_add(terminals))
        .ok_or("node count overflow")?;
    let information_sets = (config.private_states as usize)
        .checked_mul(histories)
        .ok_or("information set overflow")?;
    if nodes > u32::MAX as usize || information_sets > i32::MAX as usize {
        return Err("topology exceeds compact index capacity".into());
    }
    let total_actions = information_sets
        .checked_mul(config.actions as usize)
        .ok_or("information action overflow")?;
    if total_actions > u32::MAX as usize {
        return Err("information actions exceed u32 capacity".into());
    }

    let mut levels = vec![Level {
        kind: LevelKind::Root,
        stage: -1,
        offset: 0,
        count: 1,
    }];
    let mut offset = 1usize;
    for stage in 0..config.stages {
        let decisions = private_deals
            .checked_mul(checked_pow(branching, stage, "level decisions")?)
            .ok_or("level overflow")?;
        levels.push(Level {
            kind: LevelKind::Decision,
            stage: stage as i32,
            offset,
            count: decisions,
        });
        offset += decisions;
        let chances = decisions
            .checked_mul(config.actions as usize)
            .ok_or("chance level overflow")?;
        levels.push(Level {
            kind: LevelKind::Chance,
            stage: stage as i32,
            offset,
            count: chances,
        });
        offset += chances;
    }
    levels.push(Level {
        kind: LevelKind::Terminal,
        stage: config.stages as i32,
        offset,
        count: terminals,
    });
    offset += terminals;
    if offset != nodes {
        return Err("level layout mismatch".into());
    }

    let mut result = Compiled {
        levels,
        kind: vec![0; nodes],
        actor: vec![-1; nodes],
        first_child: vec![0; nodes],
        child_count: vec![0; nodes],
        information_set: vec![-1; nodes],
        edge_probability: vec![1.0; nodes],
        terminal_p0: vec![0.0; nodes],
        information_set_action_offset: vec![0; information_sets + 1],
        information_set_action_count: vec![config.actions as u16; information_sets],
        terminals: terminals as u32,
        chance_nodes: (1 + chance_after) as u32,
        decision_nodes: decision_nodes as u32,
        maximum_depth: 1 + config.stages * 2,
        total_information_set_actions: total_actions as u32,
    };
    for id in 0..=information_sets {
        result.information_set_action_offset[id] = (id * config.actions as usize) as u32;
    }
    result.kind[0] = 1;
    result.first_child[0] = 1;
    result.child_count[0] = private_deals as u16;
    let root_probability = 1.0 / private_deals as f64;
    for child in 1..=private_deals {
        result.edge_probability[child] = root_probability;
    }

    for level_index in 1..result.levels.len() {
        let level = result.levels[level_index];
        match level.kind {
            LevelKind::Decision => {
                let stage = level.stage as u32;
                let histories_at_stage = checked_pow(branching, stage, "decision histories")?;
                let next = result.levels[level_index + 1];
                let info_stage_offset = (config.private_states as usize)
                    .checked_mul(geometric_sum(branching, stage)?)
                    .ok_or("information stage offset overflow")?;
                for state in level.offset..level.offset + level.count {
                    let ordinal = state - level.offset;
                    let first_child = next.offset + ordinal * config.actions as usize;
                    result.kind[state] = 2;
                    result.actor[state] = (stage % 2) as i8;
                    result.first_child[state] = first_child as u32;
                    result.child_count[state] = config.actions as u16;
                    let deal = ordinal / histories_at_stage;
                    let own = if stage.is_multiple_of(2) {
                        deal / config.private_states as usize
                    } else {
                        deal % config.private_states as usize
                    };
                    result.information_set[state] = (info_stage_offset
                        + own * histories_at_stage
                        + ordinal % histories_at_stage)
                        as i32;
                }
            }
            LevelKind::Chance => {
                let stage = level.stage as u32;
                let next = result.levels[level_index + 1];
                for state in level.offset..level.offset + level.count {
                    let ordinal = state - level.offset;
                    let first_child = next.offset + ordinal * config.public_signals as usize;
                    result.kind[state] = 1;
                    result.first_child[state] = first_child as u32;
                    result.child_count[state] = config.public_signals as u16;
                    let weights = chance_weights(config, state, level.offset, stage)?;
                    let total: u32 = weights.iter().map(|value| u32::from(*value)).sum();
                    for (signal, weight) in weights.iter().enumerate() {
                        result.edge_probability[first_child + signal] =
                            f64::from(*weight) / f64::from(total);
                    }
                }
            }
            LevelKind::Terminal => {
                for state in level.offset..level.offset + level.count {
                    result.terminal_p0[state] = terminal_utility(config, state, level.offset)?;
                }
            }
            LevelKind::Root => {}
        }
    }
    Ok(result)
}

fn fnv_update(mut state: u64, bytes: &[u8]) -> u64 {
    for byte in bytes {
        state ^= u64::from(*byte);
        state = state.wrapping_mul(FNV_PRIME);
    }
    state
}

fn payload_checksum(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn push_u16(target: &mut Vec<u8>, values: &[u16]) {
    for value in values {
        target.extend_from_slice(&value.to_le_bytes());
    }
}
fn push_u32(target: &mut Vec<u8>, values: &[u32]) {
    for value in values {
        target.extend_from_slice(&value.to_le_bytes());
    }
}
fn push_i32(target: &mut Vec<u8>, values: &[i32]) {
    for value in values {
        target.extend_from_slice(&value.to_le_bytes());
    }
}
fn push_f64(target: &mut Vec<u8>, values: &[f64]) {
    for value in values {
        target.extend_from_slice(&value.to_le_bytes());
    }
}

fn payload(compiled: &Compiled) -> Vec<u8> {
    let mut value = Vec::new();
    value.extend_from_slice(&compiled.kind);
    value.extend(compiled.actor.iter().map(|entry| *entry as u8));
    push_u32(&mut value, &compiled.first_child);
    push_u16(&mut value, &compiled.child_count);
    push_i32(&mut value, &compiled.information_set);
    push_f64(&mut value, &compiled.edge_probability);
    push_f64(&mut value, &compiled.terminal_p0);
    push_u32(&mut value, &compiled.information_set_action_offset);
    push_u16(&mut value, &compiled.information_set_action_count);
    value
}

fn config_fingerprint(config: &Configuration) -> u64 {
    let canonical = format!(
        "{}|{}|{}|{}|{}|{}|{}",
        config.id,
        config.private_states,
        config.public_signals,
        config.stages,
        config.actions,
        config.seed,
        config.dependency
    );
    fnv_update(FNV_OFFSET, canonical.as_bytes())
}

fn encode(config: &Configuration, compiled: &Compiled) -> Result<Vec<u8>, String> {
    let body = payload(compiled);
    let checksum = u64::from(payload_checksum(&body));
    let mut result = Vec::with_capacity(HEADER_BYTES + body.len());
    result.extend_from_slice(MAGIC);
    result.extend_from_slice(&VERSION.to_le_bytes());
    result.extend_from_slice(&(compiled.kind.len() as u32).to_le_bytes());
    result.extend_from_slice(&(compiled.information_set_action_count.len() as u32).to_le_bytes());
    result.extend_from_slice(&compiled.maximum_depth.to_le_bytes());
    result.extend_from_slice(&compiled.total_information_set_actions.to_le_bytes());
    result.extend_from_slice(&compiled.terminals.to_le_bytes());
    result.extend_from_slice(&compiled.chance_nodes.to_le_bytes());
    result.extend_from_slice(&compiled.decision_nodes.to_le_bytes());
    result.extend_from_slice(&(body.len() as u64).to_le_bytes());
    result.extend_from_slice(&checksum.to_le_bytes());
    result.extend_from_slice(&config_fingerprint(config).to_le_bytes());
    result.extend_from_slice(&checksum.to_le_bytes());
    if result.len() != HEADER_BYTES {
        return Err("native header layout mismatch".into());
    }
    result.extend_from_slice(&body);
    Ok(result)
}

fn parse_args() -> Result<(Configuration, PathBuf), String> {
    let mut values = HashMap::<String, String>::new();
    let mut args = env::args().skip(1);
    while let Some(key) = args.next() {
        if !key.starts_with("--") {
            return Err(format!("unexpected argument {key}"));
        }
        let value = args
            .next()
            .ok_or_else(|| format!("missing value for {key}"))?;
        values.insert(key, value);
    }
    let get = |key: &str| {
        values
            .get(key)
            .cloned()
            .ok_or_else(|| format!("missing {key}"))
    };
    let number = |key: &str| -> Result<u32, String> {
        get(key)?
            .parse::<u32>()
            .map_err(|_| format!("invalid integer for {key}"))
    };
    let dependency = get("--dependency")?;
    if !matches!(
        dependency.as_str(),
        "independent" | "stage-coupled" | "history-coupled"
    ) {
        return Err("invalid dependency".into());
    }
    Ok((
        Configuration {
            id: get("--id")?,
            private_states: number("--private-states")?,
            public_signals: number("--public-signals")?,
            stages: number("--stages")?,
            actions: number("--actions")?,
            seed: number("--seed")?,
            dependency,
        },
        PathBuf::from(get("--output")?),
    ))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = path.with_extension(format!("{}.{}.tmp", process::id(), nonce));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        if path.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "refusing to overwrite native topology",
            ));
        }
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn run() -> Result<(), String> {
    let total_started = Instant::now();
    let parse_started = Instant::now();
    let (config, output) = parse_args()?;
    let parse_ms = parse_started.elapsed().as_secs_f64() * 1000.0;
    let compile_started = Instant::now();
    let compiled = compile(&config)?;
    let compile_ms = compile_started.elapsed().as_secs_f64() * 1000.0;
    let serialization_started = Instant::now();
    let bytes = encode(&config, &compiled)?;
    let serialization_ms = serialization_started.elapsed().as_secs_f64() * 1000.0;
    let write_started = Instant::now();
    write_atomic(&output, &bytes).map_err(|error| format!("write failed: {error}"))?;
    let write_ms = write_started.elapsed().as_secs_f64() * 1000.0;
    println!(
        "{{\"version\":1,\"nodes\":{},\"informationSets\":{},\"bytes\":{},\"parseMs\":{:.6},\"compileMs\":{:.6},\"serializationMs\":{:.6},\"writeMs\":{:.6},\"nativeTotalMs\":{:.6}}}",
        compiled.kind.len(),
        compiled.information_set_action_count.len(),
        bytes.len(),
        parse_ms,
        compile_ms,
        serialization_ms,
        write_ms,
        total_started.elapsed().as_secs_f64() * 1000.0
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("native-compiler-error: {error}");
        process::exit(2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Configuration {
        Configuration {
            id: "test".into(),
            private_states: 2,
            public_signals: 2,
            stages: 3,
            actions: 2,
            seed: 611,
            dependency: "history-coupled".into(),
        }
    }

    #[test]
    fn compiles_expected_counts_and_deterministic_payload() {
        let first = compile(&fixture()).unwrap();
        let second = compile(&fixture()).unwrap();
        assert_eq!(first.kind.len(), second.kind.len());
        assert_eq!(payload(&first), payload(&second));
        assert_eq!(
            first.terminals as usize + first.chance_nodes as usize + first.decision_nodes as usize,
            first.kind.len()
        );
    }

    #[test]
    fn rejects_capacity_overflow_before_allocation() {
        let mut config = fixture();
        config.stages = 31;
        assert!(
            compile(&config).unwrap_err().contains("overflow")
                || compile(&config).unwrap_err().contains("capacity")
        );
    }

    #[test]
    fn binary_has_valid_magic_and_checksum() {
        let config = fixture();
        let encoded = encode(&config, &compile(&config).unwrap()).unwrap();
        assert_eq!(&encoded[..8], MAGIC);
        let expected = u64::from_le_bytes(encoded[48..56].try_into().unwrap());
        assert_eq!(
            expected,
            u64::from(payload_checksum(&encoded[HEADER_BYTES..]))
        );
    }
}
