import "../research-console.css";
import { ResearchConsole } from "../research-console";

export const dynamic = "force-dynamic";

export default async function ResearchConsolePage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  return <ResearchConsole initialPath={path} />;
}
