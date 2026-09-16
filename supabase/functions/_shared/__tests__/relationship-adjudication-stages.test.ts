import { it, expect } from 'vitest';
import { loadProcessor } from './note-ai-processing-harness';
import { createNoteAIJobs, NoteAIJobError, classifyNoteAIError } from '../note-ai-jobs';
import { canonicalLabel, inverseLabel, isSymmetricLabel, relationshipPairKey } from '../relationship-canonical';
import { exactQuoteExists, noteContentHash } from '../relationship-adjudicator';
import * as dedup from '../profile-dedup';
import * as schema from '../profile-canonical-schema';
import * as integrity from '../profile-integrity';
import * as skillGuard from '../profile-skill-guard';
import * as nameGuard from '../profile-name-guard';
import * as factGate from '../profile-fact-gate';

it('buys each relationship judgement once as a checkpointed stage, and no more than the cap per note', async () => {
  const names = Array.from({ length: 15 }, (_, i) => `Person${String.fromCharCode(65 + i)}`);
  const content = names.map((name) => `${name} is my friend.`).join(' ');
  const relationships = names.map((name) => ({ person_a: name, person_b: 'me', label_a_to_b: 'friend', label_b_to_a: 'friend', source_quote: `${name} is my friend.`, source_context: `${name} is my friend.` }));
  const stages = new Map<string, unknown>();
  const lease = { id: 'j', user_id: 'u', note_id: 'n', lease_id: 'l', pipeline: 'analysis', desired_generation: 1, captured_generation: 1, fingerprint: 'f', snapshot: {} };
  const empty: object = new Proxy({}, { get: (_, key) => key === 'then' ? (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) : () => empty });
  const db = {
    from: () => empty,
    rpc: async (name: string, args: { _stage: string; _result?: unknown }) => {
      if (name === 'begin_note_ai_stage') return { data: stages.get(args._stage) ?? { status: 'started' }, error: null };
      if (name === 'checkpoint_note_ai_stage') stages.set(args._stage, { status: 'checkpointed', result: args._result });
      return { data: name === 'get_note_ai_job_snapshot' ? lease : true, error: null };
    },
  };
  const judged: Array<{ attribution?: unknown }> = [];
  const adjudicateRelationship = async (args: { attribution?: unknown }) => {
    judged.push(args);
    return { outcome: 'reject', reason: 'fixture', canonicalLabel: 'friend', inverseLabel: null, personAKind: 'real_person', personBKind: 'real_person', personallyRelevant: true, relationshipSupported: true, incidentalOrTransactional: false, fictionalOrRoleplay: false, confidence: 1 };
  };
  const processor = loadProcessor({
    ...dedup, ...schema, ...integrity, ...skillGuard, ...nameGuard, ...factGate,
    Deno: { env: { get: () => '' }, serve: () => {} }, createClient: () => db, createNoteAIJobs, NoteAIJobError, classifyNoteAIError,
    handleNoteAIRequest: () => {}, checkBalance: async () => ({ allowed: true }),
    runChat: async () => ({ content: JSON.stringify({ facts: [], relationships }) }),
    parseModelJson: JSON.parse, loadProfileFields: async () => [], ProfileFieldsRegistry: class {},
    profileExtractionContract: () => '', outputLanguageRule: () => '', PROCESS_NOTE_PROFILE_PROMPT: 'fixture',
    canonicalLabel, inverseLabel, isSymmetricLabel, relationshipPairKey, exactQuoteExists, noteContentHash,
    adjudicateRelationship, RELATIONSHIP_ADJUDICATION_VERSION: 'fixture',
    console: { log: () => {}, warn: () => {}, error: () => {} },
  }, 'getSuggestionPreferences=async()=>({mode:"review",profileLanguage:"en"});loadSelfContext=async()=>({enabled:false,aliases:new Set()});');
  const people = [{ name: 'Owner', canonical_name: 'Owner', is_self: true }, ...names.map((name, i) => ({ name, canonical_name: name, contact_id: `c${i}` }))];
  const run = () => processor.generateProfileSuggestions('u', 'n', 'Fixture', content, people, {}, lease);

  await run();
  expect(judged).toHaveLength(12);
  expect(judged[0].attribution).toMatchObject({ noteId: 'n', jobId: 'j', revision: 'f', stage: expect.stringMatching(/^relationship:/) });
  expect([...stages.keys()].filter((key) => key.startsWith('relationship:'))).toHaveLength(12);

  // A retry of the same revision replays every verdict instead of buying it again.
  await run();
  expect(judged).toHaveLength(12);
});
