export type AIProvider = 'doubao';

export interface AIConfig {
  apiKey: string;
  provider: AIProvider;
  model?: string;
  apiUrl?: string;
}

export interface StreamHandler {
  onToken: (token: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

export interface AIAnswerOption {
  text: string;
  label: string;
}

export interface AIResponse {
  thinking: string;
  options: AIAnswerOption[];
}

export function parseAIResponse(fullText: string): AIResponse {
  const thinkingSeparator = '---';
  const optionSeparator = '===';
  
  const thinkingEndIndex = fullText.indexOf(thinkingSeparator);
  
  if (thinkingEndIndex !== -1) {
    const thinking = fullText.slice(0, thinkingEndIndex).trim();
    const optionsPart = fullText.slice(thinkingEndIndex + thinkingSeparator.length);
    const optionBlocks = optionsPart.split(optionSeparator);
    const options: AIAnswerOption[] = [];
    
    for (const block of optionBlocks) {
      const trimmedBlock = block.trim();
      if (!trimmedBlock) continue;
      
      const lines = trimmedBlock.split('\n');
      if (lines.length === 0) continue;
      
      const firstLine = lines[0].trim();
      const match = firstLine.match(/^【(.+?)】\s*(.+)$/);
      if (match) {
        const label = `${match[1].trim()} ${match[2].trim()}`;
        const text = lines.slice(1).join('\n').trim();
        
        if (text) {
          options.push({
            label,
            text
          });
        }
      }
    }
    
    if (options.length > 0) {
      return {
        thinking,
        options
      };
    }
  }
  
  try {
    const jsonStart = fullText.indexOf('{');
    const jsonEnd = fullText.lastIndexOf('}') + 1;
    
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      const jsonStr = fullText.slice(jsonStart, jsonEnd);
      const json = JSON.parse(jsonStr);
      if (json.thinking && json.options && Array.isArray(json.options)) {
        const validOptions = json.options
          .filter((opt: any) => opt && opt.label && opt.text)
          .map((opt: any) => ({
            label: String(opt.label).trim(),
            text: String(opt.text).trim()
          }));
        
        if (validOptions.length > 0) {
          return {
            thinking: String(json.thinking).trim(),
            options: validOptions
          };
        }
      }
    }
  } catch {
  }
  
  const lines = fullText.split('\n');
  const fallbackThinkingLines: string[] = [];
  const fallbackOptions: AIAnswerOption[] = [];
  
  let inThinking = true;
  let currentOption: AIAnswerOption | null = null;
  
  const optionStartRegexes = [
    /^\s*(\d+)\.\s*【(.+?)】\s*(.*)/,
    /^#{1,6}\s*(\d+)\.\s*【(.+?)】\s*(.*)/,
    /^\s*(\d+)\.\s*\[(.+?)\]\s*(.*)/,
    /^\s*(\d+)\.\s*\((.+?)\)\s*(.*)/,
  ];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    let matched = false;
    for (const regex of optionStartRegexes) {
      const match = trimmedLine.match(regex);
      if (match) {
        inThinking = false;
        if (currentOption) {
          fallbackOptions.push(currentOption);
        }
        const labelSuffix = match[3]?.trim() || '';
        currentOption = {
          label: labelSuffix ? `${match[2]} ${labelSuffix}` : match[2],
          text: ''
        };
        matched = true;
        break;
      }
    }
    
    if (matched) continue;
    
    if (inThinking) {
      fallbackThinkingLines.push(line);
    } else if (currentOption) {
      if (currentOption.text) {
        currentOption.text += '\n';
      }
      currentOption.text += line;
    }
  }
  
  if (currentOption) {
    fallbackOptions.push(currentOption);
  }
  
  const thinking = fallbackThinkingLines.join('\n').trim();
  
  if (fallbackOptions.length === 0) {
    return {
      thinking: '',
      options: [{ text: fullText, label: '默认' }]
    };
  }
  
  const cleanedOptions = fallbackOptions.map(opt => ({
    label: opt.label.trim(),
    text: opt.text.trim()
  })).filter(opt => opt.text.length > 0);
  
  if (cleanedOptions.length === 0) {
    return {
      thinking,
      options: [{ text: fullText, label: '默认' }]
    };
  }
  
  return {
    thinking,
    options: cleanedOptions
  };
}

const DEFAULT_API_URLS: Record<AIProvider, string> = {
  doubao: 'https://ark.cn-beijing.volces.com/api/v3/responses',
};

const DEFAULT_MODELS: Record<AIProvider, string> = {
  doubao: 'doubao-seed-2-0-lite-260215',
};

export async function streamAIPolish(
  text: string,
  config: AIConfig,
  handler: StreamHandler
): Promise<() => void> {
  const abortController = new AbortController();
  const apiUrl = config.apiUrl || DEFAULT_API_URLS[config.provider];
  const model = config.model || DEFAULT_MODELS[config.provider];

  const prompt = `优化文本：${text}

请严格按照以下格式输出：
你的优化思路和分析过程

---

【方案1】标签名称
优化后的文本内容

===

【方案2】标签名称
优化后的文本内容

===

【方案3】标签名称
优化后的文本内容

===

【方案4】标签名称
优化后的文本内容

===

【方案5】标签名称
优化后的文本内容

要求：
1. 要求说明优化思路
2. 使用 --- 分隔思考和方案
3. 使用 === 分隔不同方案
4. 每个方案的标签用【】包含
5. 提供5种不同风格的优化版本
6. 保持原意不变，语言更流畅自然
7. 不要输出任何多余内容
8. 【方案N】和标签名称必须在同一行，不要换行


示例

【思考】
原句过于直白，需要优化表达

---

【方案1】通用得体版
您好，我是新来的同事小张，请问我的工位在哪里？

===

【方案2】轻松活泼版
哈喽大家好，我是小张，请问我坐哪儿呀？

===

【方案3】正式严谨版
您好，我是新入职的员工小张，烦请告知我的座位安排。

===

【方案4】简洁高效版
你好，我是新同事小张，请问我的座位在哪？

===

【方案5】亲切友好版
嗨～我是今天新来的小张，想问一下我的工位安排在哪儿呢？`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: prompt,
              },
            ],
          },
        ],
        stream: true,
      }),
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6);
          if (jsonStr.trim() === '[DONE]') {
            handler.onComplete();
            return () => abortController.abort();
          }
          try {
            const json = JSON.parse(jsonStr);
            // Responses API 的流式输出格式
            const token = json.delta || '';
            if (token) {
              handler.onToken(token);
            }
          } catch (e) {
            // SyntaxError 是正常的（不完整的 JSON 或空行），忽略
            // 其他错误记录日志以便调试
            if (!(e instanceof SyntaxError)) {
              console.warn('[AI] Failed to parse SSE chunk:', e);
            }
          }
        }
      }
    }

    handler.onComplete();
  } catch (error) {
    if (error instanceof Error && error.name !== 'AbortError') {
      handler.onError(error);
    }
  }

  return () => abortController.abort();
}

export async function callAIPolish(
  text: string,
  config: AIConfig
): Promise<string> {
  return new Promise((resolve, reject) => {
    let result = '';
    streamAIPolish(text, config, {
      onToken: (token) => {
        result += token;
      },
      onComplete: () => {
        resolve(result);
      },
      onError: (error) => {
        reject(error);
      },
    });
  });
}
