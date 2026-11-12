export interface StepSpec {
  requestId: string;
  timestamp: number;
  input?: number;
  output?: number;
  cache?: number;
  /** 传 null 表示省略 total_tokens，由解析层用 input + output 兜底。 */
  total?: number | null;
  model?: string;
  modelName?: string;
  type?: string;
}

export function stepLine(spec: StepSpec): string {
  const input = spec.input ?? 0;
  const output = spec.output ?? 0;
  const usage: Record<string, unknown> = {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: spec.cache ?? 0,
  };
  if (spec.total !== null) {
    usage.total_tokens = spec.total ?? input + output;
  }

  const line: Record<string, unknown> = {
    type: spec.type ?? 'function_call',
    timestamp: spec.timestamp,
    providerData: {
      conversationRequestId: spec.requestId,
      model: spec.model ?? 'model-a',
      requestModelName: spec.modelName ?? 'Model-A',
    },
    message: { usage },
  };
  return JSON.stringify(line);
}
