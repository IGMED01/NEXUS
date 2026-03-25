// @ts-check
/**
 * OpenRouter LLM provider — supports free models.
 * Set OPENROUTER_API_KEY env var, or GROQ_API_KEY for Groq fallback.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";

/**
 * @param {{ query: string, context?: string, model?: string }} opts
 * @returns {Promise<{ ok: boolean, response: string, model: string, tokens: number, provider: string }>}
 */
export async function chatCompletion({ query, context, model }) {
  // Try providers in order: OpenRouter → Groq → Cerebras
  const providers = [];

  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      name: "openrouter",
      url: OPENROUTER_URL,
      key: process.env.OPENROUTER_API_KEY,
      model: model || "mistralai/mistral-7b-instruct:free",
      headers: { "HTTP-Referer": "https://github.com/IGMED01/Nexus-Context-Orchestration-Engine-for-LLM-Systems", "X-Title": "NEXUS" }
    });
  }

  if (process.env.GROQ_API_KEY) {
    providers.push({
      name: "groq",
      url: GROQ_URL,
      key: process.env.GROQ_API_KEY,
      model: model || "llama-3.3-70b-versatile",
      headers: {}
    });
  }

  if (process.env.CEREBRAS_API_KEY) {
    providers.push({
      name: "cerebras",
      url: CEREBRAS_URL,
      key: process.env.CEREBRAS_API_KEY,
      model: model || "llama-3.3-70b",
      headers: {}
    });
  }

  if (providers.length === 0) {
    return { ok: false, response: "No LLM API key configured. Set OPENROUTER_API_KEY, GROQ_API_KEY, or CEREBRAS_API_KEY.", model: "none", tokens: 0, provider: "none" };
  }

  const systemPrompt = context
    ? `Eres NEXUS, un asistente de inteligencia contextual. Responde SOLO usando el contexto proporcionado. Si la respuesta no está en el contexto, dilo claramente. Sé conciso y preciso.\n\n--- CONTEXTO ---\n${context}\n--- FIN CONTEXTO ---`
    : `Eres un asistente general sin acceso a documentos específicos. Responde con conocimiento general. Aclara que no tienes acceso a documentación específica del usuario.`;

  for (const p of providers) {
    try {
      const res = await fetch(p.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${p.key}`,
          ...p.headers
        },
        body: JSON.stringify({
          model: p.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: query }
          ],
          max_tokens: 1024,
          temperature: 0.3
        })
      });

      if (!res.ok) continue;

      const data = await res.json();
      const choice = data.choices?.[0];
      if (!choice) continue;

      return {
        ok: true,
        response: choice.message?.content ?? "",
        model: data.model ?? p.model,
        tokens: data.usage?.total_tokens ?? 0,
        provider: p.name
      };
    } catch {
      continue;
    }
  }

  return { ok: false, response: "All LLM providers failed.", model: "none", tokens: 0, provider: "none" };
}
