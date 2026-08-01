export type ModelProvider = "ollama" | "openai";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = { temperature?: number; jsonMode?: boolean };

export type ProviderConfig =
  | {
      provider: "ollama";
      baseUrl: string;
      model: string;
    }
  | {
      provider: "openai";
      model: string;
    };

export type ProviderStatus = {
  ollama: {
    available: boolean;
    error?: string;
  };
  openai: {
    configured: boolean;
    maskedKey?: string;
  };
};

const EXPORT_HELPER_URL = "http://127.0.0.1:3031";

type OllamaChatResponse = {
  message?: {
    role?: string;
    content?: string;
  };
  error?: string;
};

type HelperChatResponse = {
  ok?: boolean;
  content?: string;
  error?: string;
};

async function chatWithOllama(params: {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  options?: ChatOptions;
}): Promise<string> {
  const url = `${params.baseUrl.replace(/\/+$/, "")}/api/chat`;
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        stream: false,
        keep_alive: "0s",
        ...(params.options?.jsonMode ? { format: "json" } : {}),
        options: { temperature: params.options?.temperature ?? 0.3 }
      })
    });
  } catch {
    throw new Error(
      `Cannot reach Ollama at ${params.baseUrl}. Start Ollama and confirm the base URL is correct.`
    );
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama HTTP ${response.status}: ${body || response.statusText}`);
  }

  const data = (await response.json()) as OllamaChatResponse;
  if (data.error) {
    throw new Error(`Ollama error: ${data.error}`);
  }

  const content = data.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Ollama response did not include message.content");
  }

  return content.trim();
}

async function chatWithOpenAI(params: { model: string; messages: ChatMessage[]; options?: ChatOptions }): Promise<string> {
  let response: Response;

  try {
    response = await fetch(`${EXPORT_HELPER_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        model: params.model,
        messages: params.messages,
        temperature: params.options?.temperature,
        jsonMode: params.options?.jsonMode
      })
    });
  } catch {
    throw new Error(
      "Cannot reach local helper (http://127.0.0.1:3031). Start it with `npm run export-helper` and try again."
    );
  }

  const data = (await response.json()) as HelperChatResponse;
  if (!response.ok || !data.ok || typeof data.content !== "string") {
    throw new Error(data.error || `OpenAI helper HTTP ${response.status}`);
  }

  return data.content.trim();
}

export async function chatWithProvider(config: ProviderConfig, messages: ChatMessage[], options?: ChatOptions): Promise<string> {
  if (config.provider === "ollama") {
    return chatWithOllama({
      baseUrl: config.baseUrl,
      model: config.model,
      messages,
      options
    });
  }

  return chatWithOpenAI({
    model: config.model,
    messages,
    options
  });
}

export async function saveOpenAIKey(apiKey: string): Promise<{ maskedKey: string }> {
  let response: Response;
  try {
    response = await fetch(`${EXPORT_HELPER_URL}/openai-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey })
    });
  } catch {
    throw new Error(
      "Cannot reach local helper (http://127.0.0.1:3031). Start it with `npm run export-helper` before saving the key."
    );
  }

  const data = (await response.json()) as { ok?: boolean; maskedKey?: string; error?: string };
  if (!response.ok || !data.ok || !data.maskedKey) {
    throw new Error(data.error || `OpenAI key save failed with HTTP ${response.status}`);
  }

  return { maskedKey: data.maskedKey };
}

export async function loadProviderStatus(ollamaBaseUrl: string): Promise<ProviderStatus> {
  const [ollamaResult, helperResult] = await Promise.allSettled([
    fetch(`${ollamaBaseUrl.replace(/\/+$/, "")}/api/tags`),
    fetch(`${EXPORT_HELPER_URL}/provider-status`)
  ]);

  const ollamaAvailable =
    ollamaResult.status === "fulfilled" && ollamaResult.value.ok;

  let openai = { configured: false, maskedKey: undefined as string | undefined };
  if (helperResult.status === "fulfilled" && helperResult.value.ok) {
    const data = (await helperResult.value.json()) as {
      openai?: { configured?: boolean; maskedKey?: string };
    };
    openai = {
      configured: !!data.openai?.configured,
      maskedKey: data.openai?.maskedKey
    };
  }

  return {
    ollama: {
      available: ollamaAvailable,
      error: ollamaAvailable ? undefined : "Unavailable"
    },
    openai
  };
}
