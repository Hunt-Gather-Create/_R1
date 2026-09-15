/**
 * Positive control for _R1#156's model-free-proof test
 * (`../model-free.test.ts`). Exists only to prove that test's `vi.mock`
 * stubs actually intercept a real import of the AI SDK, rather than passing
 * because nothing in the mocked scope ever touches the module at all. Never
 * imported by production code.
 */
import { generateText } from "ai";

export async function callsModelBoundary(): Promise<string> {
  const { text } = await generateText({
    model: "stub-model" as never,
    prompt: "this call must never actually run",
  } as never);
  return text;
}
