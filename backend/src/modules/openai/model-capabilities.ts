/**
 * Per-model capability flags.
 *
 * GPT-5 / o1 / o3 reasoning models REJECT any non-default `temperature`
 * value with HTTP 400 ("Unsupported value: 'temperature' does not support
 * <X>"). For those families we MUST omit `temperature` entirely.
 *
 * For non-reasoning models we keep the long-standing default so unrelated
 * callers see no behaviour change. This is the central gate; individual
 * call sites no longer need to know which models accept temperature.
 */
const NO_TEMPERATURE_PREFIXES = ['gpt-5', 'o1', 'o3'];

export function modelSupportsTemperature(model: string): boolean {
  const lower = (model ?? '').toLowerCase();
  return !NO_TEMPERATURE_PREFIXES.some((p) => lower.startsWith(p));
}
