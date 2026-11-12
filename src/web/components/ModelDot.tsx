import { modelColor } from '../model-colors.ts';

interface ModelDotProps {
  modelKey: string;
}

export function ModelDot({ modelKey }: ModelDotProps) {
  return (
    <span
      className="model-dot"
      style={{ backgroundColor: modelColor(modelKey) }}
      aria-hidden="true"
    />
  );
}
