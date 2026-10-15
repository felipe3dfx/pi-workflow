import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
export default function fixture(pi) {
 const p = fauxProvider({ provider: 'fleet-fixture', models: [{ id: 'local', contextWindow: 10000000, maxTokens: 100000 }], tokensPerSecond: 5000, tokenSize: { min: 256, max: 256 } });
 pi.registerProvider(p.provider);
 pi.registerTool({ name: 'fixture_result', label: 'Fixture result', description: 'Offline fixture', parameters: Type.Object({}), async execute() { return { content: [{ type: 'text', text: process.env.FLEET_LARGE === 'large-tool' ? 'T'.repeat(300000) : 'tool-result\n'.repeat(400) }], details: {} }; } });
 pi.on('before_agent_start', () => p.appendResponses([
  fauxAssistantMessage([{ type: 'thinking', thinking: 'reasoning fixture\n'.repeat(80) }, fauxToolCall('fixture_result', {})], { stopReason: 'toolUse' }),
  fauxAssistantMessage(process.env.FLEET_LARGE === 'large-text' ? 'L'.repeat(180000) : 'audit transcript\n'.repeat(4096)),
 ]));
}
