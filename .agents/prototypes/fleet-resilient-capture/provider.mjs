import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
export default function fixture(pi) {
 const p=fauxProvider({provider:'fleet-fixture',models:[{id:'local',contextWindow:10000000,maxTokens:100000}],tokensPerSecond:100000,tokenSize:{min:4096,max:4096}});
 pi.registerProvider(p.provider);
 pi.registerTool({name:'fixture_result',label:'Fixture result',description:'Offline bounded fixture',parameters:Type.Object({}),async execute(){return {content:[{type:'text',text:'T'.repeat(300000)}],details:{fixture:true}};}});
 pi.on('before_agent_start',()=>p.appendResponses([
  fauxAssistantMessage([{type:'thinking',thinking:'offline fixture reasoning'},fauxToolCall('fixture_result',{})],{stopReason:'toolUse'}),
  fauxAssistantMessage('L'.repeat(180000)),
 ]));
}
