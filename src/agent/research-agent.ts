import "dotenv/config";
import OpenAI from "openai";
import { readKnowledge } from "../tools/read-knowledge.js";
import { readSource } from "../tools/read-source.js";
import { searchWeb } from "../tools/search-web.js";
import { updateKnowledge } from "../tools/update-knowledge.js";

const client = new OpenAI();

// Cap how much page text is fed back to the model to stay within token limits.
const MAX_SOURCE_CHARS = 6000;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "searchWeb",
      description: "Search the web for up-to-date information about a topic.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "readSource",
      description:
        "Fetch a web page by URL and return its readable text content. Use this to read a source found via searchWeb.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL of the page to read.",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "readKnowledge",
      description:
        "Read existing knowledge stored as local Markdown files. Accepts a topic name or file path and returns the saved notes. Use this after reading web sources to check what is already known.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description:
              'A topic name (e.g. "agent-memory") or a relative Markdown file path within the knowledge directory.',
          },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "updateKnowledge",
      description:
        "Save genuinely new or significantly changed knowledge to a local Markdown file inside the knowledge directory. Always call readKnowledge first, and only update when the information is not already captured.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              'A relative Markdown file path within the knowledge directory (e.g. "concepts/agent-memory.md"). Created if it does not exist.',
          },
          content: {
            type: "string",
            description:
              "The new knowledge content to append. Existing file content is preserved.",
          },
        },
        required: ["path", "content"],
      },
    },
  },
];

async function callTool(name: string, args: string): Promise<string> {
  if (name === "searchWeb") {
    const { query } = JSON.parse(args) as { query: string };
    const results = await searchWeb(query);
    return JSON.stringify(results);
  }

  if (name === "readSource") {
    const { url } = JSON.parse(args) as { url: string };
    const source = await readSource(url);
    // Keep the model input small: cap page content to avoid TPM limits.
    return JSON.stringify({
      ...source,
      content: source.content.slice(0, MAX_SOURCE_CHARS),
    });
  }

  if (name === "readKnowledge") {
    const { topic } = JSON.parse(args) as { topic: string };
    const entry = await readKnowledge(topic);
    return JSON.stringify(entry);
  }

  if (name === "updateKnowledge") {
    const { path, content } = JSON.parse(args) as {
      path: string;
      content: string;
    };
    const result = await updateKnowledge(path, content);
    return JSON.stringify(result);
  }

  throw new Error(`Unknown tool: ${name}`);
}

export async function runResearchAgent(query: string): Promise<string> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are a research assistant. Use the searchWeb tool to gather information and readSource to read promising pages before answering. Before saving anything, call readKnowledge to check what is already known. Only call updateKnowledge when you find genuinely new or significantly changed information that is not already captured; never duplicate existing knowledge. Provide a concise, well-sourced final answer.",
    },
    {
      role: "user",
      content: query,
    },
  ];

  while (true) {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools,
    });

    const message = response.choices[0]?.message;

    if (!message) {
      throw new Error("No response from the model");
    }

    messages.push(message);

    // Model final cevabı verdiyse döngüyü sonlandır.
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content ?? "";
    }

    // Model bir veya birden fazla tool çağırdıysa hepsini çalıştırıp sonucu geri ver.
    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") {
        continue;
      }

      const result = await callTool(
        toolCall.function.name,
        toolCall.function.arguments,
      ).catch((error: unknown) =>
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }
}
