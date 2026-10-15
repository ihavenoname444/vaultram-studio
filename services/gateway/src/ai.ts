import {
  AppSpecSchema,
  exampleSpec,
} from "../../../packages/core/src/index.ts";
import { z } from "zod";
const DescriptionSchema = AppSpecSchema.pick({
  name: true,
  description: true,
  accent: true,
}).strict();
export async function describe(prompt: string) {
  const key = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL;
  if (!key || !model)
    return {
      spec: { ...exampleSpec },
      provenance: "FIXTURE" as const,
      note: "Example specification loaded. Configure OPENAI_API_KEY and OPENAI_MODEL to generate from your description.",
    };
  let previous = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: "Bearer " + key,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(45000),
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 1500,
        instructions:
          "Translate the user description into a short title and description for a public agent marketplace. Return data only. The only supported entities are agents, services and small public memories. No payments, secret storage, bridging or autonomous execution. Do not claim unsupported features. " +
          previous,
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "marketplace_description",
            strict: true,
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                accent: { type: "string", enum: ["mint", "blue", "amber"] },
              },
              required: ["name", "description", "accent"],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    if (!r.ok)
      throw new Error(
        "AI provider unavailable (" +
          r.status +
          "); no specification was generated",
      );
    const response = await r.json();
    if (response.status !== "completed")
      throw new Error("AI response incomplete");
    const output = response.output
      ?.flatMap(
        (o: { content?: Array<{ type: string; text?: string }> }) =>
          o.content ?? [],
      )
      .filter((c: { type: string }) => c.type === "output_text")
      .map((c: { text: string }) => c.text)
      .join("");
    try {
      return {
        spec: AppSpecSchema.parse({
          ...exampleSpec,
          ...DescriptionSchema.parse(JSON.parse(output)),
        }),
        provenance: "OPENAI" as const,
        note: "AI supplied descriptive fields. Runtime, schema and permissions come from versioned template v1.",
      };
    } catch {
      previous =
        "Previous output did not meet local validation. Name <=60 UTF-8 bytes; description <=500 UTF-8 bytes. Repair once.";
    }
  }
  throw new Error("Generated specification failed validation after one repair");
}
