/**
 * policyParser.ts
 */

import { callGemini } from "./geminiRouter.js";
import type { ParsePolicyRequest, ParsePolicyResponse, PolicyRule } from "../shared/types.js";

const LOG = "[policy-parser]";

function buildPrompt(name: string, text: string): string {
  return `\
Ty opytnyy redaktor i lingvist. Tvoya zadacha — izvlechʹ VSE pravila iz dokumenta redaktsionnoy politiki.

NAZVANIE DOKUMENTA: ${name}

POLNYY TEKST DOKUMENTA:
===BEGIN===
${text}
===END===

Zadacha: proanaliziruy kazhdyy razdel dokumenta i izvleki iz nego redaktsionnye pravila.
Pravilo — eto lyuboe trebovaniye k tekstam: zapreshchonnye slova, stilistika, ton, tipografika,
struktura materiala, trebovaniya k zagolovkam, abzatsam, ssylkam, izobrazeniyam, tsitirovanniyu i t.d.

VERNI TOLʹKO JSON (bez ```markdown blokov, bez obʹyasneniy do ili posle).
Format otveta:
{
  "rules": [
    {
      "id": "rule-1",
      "category": "<odno iz: stop-word | style | tone | structure | typography | abbreviation | factual | custom>",
      "name": "<kratkoe nazvanie pravila>",
      "description": "<podrobnoe opisanie 2-4 predlozeniya>",
      "severity": "<odno iz: error | warning | info>",
      "examples": [
        { "bad": "<primer narusheniya>", "good": "<pravilnyy variant>" }
      ],
      "source": "<ssylka na razdel dokumenta ili pustaya stroka>"
    }
  ],
  "summary": "<2-3 predlozeniya: o chom eta politika i dlya kakikh tekstov>"
}

VAZHNO:
1. Otvet DOLZHEN nachinatsya s { i zakanchivatsya na } — nichego lishnego
2. Ignoriruй lyubye PDF-metadannye (format, version, page_count, producer i t.p.)
3. Esli v razdele net yavnykh pravil — sformuliruй ikh iz smysla teksta
4. Izvleki minimum 5 pravil esli dokument soderzhit khoby redaktsionnye trebovaniya
`;
}

function extractJson(raw: string): string {
  let s = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
  const start = s.indexOf("{");
  const end   = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  return s;
}

export async function parsePolicy(
  req: ParsePolicyRequest,
): Promise<ParsePolicyResponse> {
  const apiKey = process.env.GEMINI_API_KEY!;

  // Отправляем полный текст без обрезки
  const docText = req.rawText;
  console.info(`${LOG} starting parse «${req.name}» (${docText.length} chars)`);

  const contents = [
    { role: "user", parts: [{ text: buildPrompt(req.name, docText) }] },
  ];
  const generationConfig = { temperature: 0.1 };

  try {
    const result = await callGemini(contents, generationConfig, apiKey);

    console.info(`${LOG} raw response from ${result.model} (${result.raw.length} chars):`);
    console.info(`${LOG} --- RAW START ---`);
    console.info(result.raw.slice(0, 4000));
    if (result.raw.length > 4000)
      console.info(`${LOG} ... [truncated, total ${result.raw.length} chars]`);
    console.info(`${LOG} --- RAW END ---`);

    const jsonStr = extractJson(result.raw);
    console.info(`${LOG} extracted JSON (${jsonStr.length} chars)`);

    let parsed: { rules: PolicyRule[]; summary?: string };
    try {
      parsed = JSON.parse(jsonStr) as { rules: PolicyRule[]; summary?: string };
    } catch (jsonErr) {
      console.error(`${LOG} JSON.parse FAILED:`, jsonErr instanceof Error ? jsonErr.message : jsonErr);
      console.error(`${LOG} extracted snippet: ${jsonStr.slice(0, 500)}`);
      throw new Error(
        `JSON parse error: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}. ` +
        `Raw (first 200): ${result.raw.slice(0, 200)}`
      );
    }

    const ruleCount = parsed.rules?.length ?? 0;
    console.info(`${LOG} parsed OK — ${ruleCount} rules, summary: ${parsed.summary?.slice(0, 80) ?? "(none)"}`);

    if (ruleCount === 0) {
      console.warn(`${LOG} WARNING: 0 rules. Full object:`);
      console.warn(JSON.stringify(parsed, null, 2).slice(0, 1000));
    }

    return { rules: parsed.rules ?? [], summary: parsed.summary, _label: result.label };
  } catch (err) {
    console.error(`${LOG} ERROR:`, err instanceof Error ? err.message : err);
    return { rules: [], error: err instanceof Error ? err.message : String(err) };
  }
}
