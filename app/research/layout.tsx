import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Research Console · Preflop Lab",
  description: "Console local para experimentos sintéticos do Preflop Lab Research Engine.",
};

export default function ResearchLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
