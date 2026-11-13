import { logos } from "../site/src/data/logos";
import type { AiProvider } from "./ai";

// Official marks (Simple Icons, CC0) shared with the site; shapes stay unmodified. OpenAI's mark is monochrome, so it follows the text color.
const MARKS: Record<AiProvider, { d: string; color: string }> = {
  chatgpt: { d: logos.openai.d, color: "currentColor" },
  claude: { d: logos.claude.d, color: logos.claude.color },
  openrouter: { d: logos.openrouter.d, color: logos.openrouter.color },
};

export function ProviderLogo({ provider, size = 14 }: { provider: AiProvider; size?: number }) {
  const { d, color } = MARKS[provider];
  return <svg className="provider-logo" viewBox="0 0 24 24" width={size} height={size} fill={color} aria-hidden="true"><path d={d} /></svg>;
}
