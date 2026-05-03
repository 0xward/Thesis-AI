import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const PRIMARY_MODEL = "gemini-3-flash-preview";
const FALLBACK_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash",
  "gemini-1.5-pro"
];

async function callWithFallback(fn: (model: string) => Promise<any>) {
  const allModels = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastError: any = null;

  for (const model of allModels) {
    try {
      console.log(`Attempting generation with model: ${model}`);
      return await fn(model);
    } catch (e: any) {
      lastError = e;
      const errorMsg = e.message?.toLowerCase() || "";
      if (errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("limit")) {
        console.warn(`Quota reached for ${model}, trying fallback...`);
        continue;
      }
      throw e; // If it's not a quota error, throw it immediately
    }
  }
  throw lastError;
}

export interface ThesisConfig {
  targetLanguage: string;
  major: string;
  thesisLevel: string; // Undergraduate, Masters, PhD
  writingStyle: string;
  contentLength: 'Short' | 'Standard' | 'Comprehensive';
  fontFamily: 'Serif' | 'Sans';
  antiPlagiarism: boolean;
  citationStyle: string;
}

export interface ResearchSource {
  type: 'url' | 'pdf' | 'text';
  content: string;
  title?: string;
}

export interface ThesisStructure {
  title: string;
  chapters: ChapterDefinition[];
}

export interface ChapterDefinition {
  chapter_title: string;
  summary: string;
  subchapters: string[];
}

export async function generateTitleOptions(sources: ResearchSource[], config: ThesisConfig): Promise<string[]> {
  const sourceTexts = sources.map((s, i) => `Source ${i + 1}:\n${s.content.substring(0, 10000)}`).join('\n\n---\n\n');
  const prompt = `You are an elite academic Research Agent.
Based on the provided sources and configuration, generate 5 formal, convincing thesis title options that align with academic standards.
Academic Major: ${config.major}
Tone/Formal: ${config.writingStyle}
Language: ${config.targetLanguage}
Level: ${config.thesisLevel}

Sources:
${sourceTexts}

Return a JSON array of strings.`;

  const response = await callWithFallback((model) => 
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING, description: "A highly academic and formal thesis title" }
        }
      }
    })
  );

  const text = response.text || "[]";
  try {
    return JSON.parse(text) as string[];
  } catch (e) {
    console.error("Failed to parse JSON response:", text);
    throw new Error("Failed to generate titles.");
  }
}

export async function generateThesisStructure(sources: ResearchSource[], config: ThesisConfig, customTitle?: string): Promise<ThesisStructure> {
  const sourceTexts = sources.map((s, i) => `Source ${i + 1}:\n${s.content.substring(0, 50000)}`).join('\n\n---\n\n');
  
  const lengthGuidance = config.contentLength === 'Short' ? '5 focus chapters' : config.contentLength === 'Comprehensive' ? '8-10 extensive chapters' : '6-7 standard chapters';

  const prompt = `You are an elite academic Research Agent.
Based on the provided sources, generate a complete ${config.thesisLevel} thesis structure in ${config.targetLanguage}.
Academic Major: ${config.major}
Tone/Formal: ${config.writingStyle}
Target Complexity: ${lengthGuidance}

${customTitle ? `STRICT INSTRUCTION: Use exactly this title for the thesis: "${customTitle}"` : "Generate a formal thesis title, and a structured array of chapters including standard sections (Introduction, Literature Review, Methodology, Results, Conclusion)."}

Sources:
${sourceTexts}
`;

  const response = await callWithFallback((model) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Formal thesis title" },
            chapters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  chapter_title: { type: Type.STRING, description: "Title of the chapter" },
                  summary: { type: Type.STRING, description: "Brief description of what this chapter will cover" },
                  subchapters: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  }
                },
                required: ["chapter_title", "summary", "subchapters"]
              }
            }
          },
          required: ["title", "chapters"]
        }
      }
    })
  );

  const text = response.text || "{}";
  try {
    return JSON.parse(text) as ThesisStructure;
  } catch (e) {
    console.error("Failed to parse JSON response:", text);
    throw new Error("Failed to generate structure.");
  }
}

export async function generateChapterContentStream(
  chapter: ChapterDefinition,
  fullStructure: ThesisStructure,
  sources: ResearchSource[],
  config: ThesisConfig,
  previousContext: string = ""
) {
  const sourceTexts = sources.map((s, i) => `Source ${i + 1} (${s.title || 'Untitled'}):\n${s.content.substring(0, 50000)}`).join('\n\n---\n\n');
  
  const lengthGuidance = config.contentLength === 'Short' ? 'concise and direct' : config.contentLength === 'Comprehensive' ? 'extremely detailed, analytical, and extensive' : 'detailed';

  const antiPlagiarismInstruction = config.antiPlagiarism ? `
### ANTI-PLAGIARISM DIRECTIVE
You MUST rewrite and paraphrase all content naturally. DO NOT copy directly from the sources. Maintain the original meaning and accuracy but ensure the phrasing is entirely novel and original. Synthesize multiple points instead of quoting directly where possible to reduce similarity scores. Ensure the output sounds human-written, academically valid, and highly original.
` : "";

  const prompt = `You are an elite academic Research Agent writing a ${config.thesisLevel} thesis for a ${config.major} major in ${config.targetLanguage}.
Style: ${config.writingStyle}
Target Depth: ${lengthGuidance}

Thesis Title: ${fullStructure.title}

Write the full contents for the following chapter in Markdown format. The generated chapter should be comprehensive, academically rigorous, use formal formatting, and synthesize the source material instead of just copying it. Expand ideas intelligently. Use inline citations where relevant following the ${config.citationStyle} citation style format. CRITICAL: You must ALSO append the source index in brackets as a special tag immediately after the citation, formatted EXACTLY as \`[SRC_1]\`, \`[SRC_2]\`, etc., corresponding to the Source Number. This is required for the UI to map the source.

Chapter Title: ${chapter.chapter_title}
Chapter Goals/Summary: ${chapter.summary}
Subchapters to include:
${chapter.subchapters.map(s => "- " + s).join("\n")}

### RULES
1. Write ONLY the content for this specific chapter. Do not output anything else.
2. Use Markdown formatting. Start with an H1 heading for the chapter title, and H2 for subchapters.
3. Be extensive, professional, and detailed. DO NOT output a short summary, write detailed academic paragraphs simulating a real human researcher.
${config.contentLength === 'Comprehensive' ? '4. Aim for high word count (at least 2000-3000 words for this chapter if possible).' : ''}
4. Maintain continuity.
${antiPlagiarismInstruction}
### PREVIOUS CHAPTERS CONTEXT (For continuity):
${previousContext ? previousContext : "None."}

### SOURCE MATERIAL:
${sourceTexts}
`;

  return await callWithFallback((model) => 
    ai.models.generateContentStream({
      model,
      contents: prompt,
    })
  );
}
