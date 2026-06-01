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

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function chatWithAgent(message: string, currentThesis: any, sources: ResearchSource[], config: ThesisConfig): Promise<string> {
  const response = await postJson<{ text: string }>('/api/ai/chat', { message, currentThesis, sources, config });
  return response.text || 'No response generated.';
}

export async function generateReferences(sources: ResearchSource[], config: ThesisConfig): Promise<{ chapterTitle: string, content: string }> {
  return postJson<{ chapterTitle: string, content: string }>('/api/ai/references', { sources, config });
}

export async function generateTitleOptions(sources: ResearchSource[], config: ThesisConfig): Promise<string[]> {
  const response = await postJson<{ titles: string[] }>('/api/ai/titles', { sources, config });
  return response.titles;
}

export async function generateThesisStructure(sources: ResearchSource[], config: ThesisConfig, customTitle?: string): Promise<ThesisStructure> {
  return postJson<ThesisStructure>('/api/ai/structure', { sources, config, customTitle });
}

export async function generateChapterContentStream(
  chapter: ChapterDefinition,
  fullStructure: ThesisStructure,
  sources: ResearchSource[],
  config: ThesisConfig,
  previousContext: string = ""
): Promise<AsyncGenerator<{ text: string }>> {
  const response = await fetch('/api/ai/chapter-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapter, fullStructure, sources, config, previousContext }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(detail || `Streaming request failed with status ${response.status}`);
  }

  async function* streamText() {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) yield { text };
    }
  }

  return streamText();
}
