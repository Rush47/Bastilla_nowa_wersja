import test from 'node:test';
import assert from 'node:assert/strict';
import { chatContext, geminiModel } from '../src/lib/chatContext.ts';

test('chat context retains conversation order and excludes failed, pending and system replies', () => {
  const history = [
    { id: '1', role: 'user', status: 'saved', content: 'Mam na imię Jan' },
    { id: '2', role: 'assistant', status: 'delivered', content: 'Cześć Jan' },
    { id: '3', role: 'system', status: 'delivered', content: 'diagnostyka' },
    { id: '4', role: 'agent', status: 'queued', content: 'Przygotowuję odpowiedź…' },
    { id: '5', role: 'assistant', status: 'failed', content: 'błąd połączenia' },
  ];
  assert.deepEqual(chatContext(history).map(m => m.id), ['1', '2']);
  assert.equal(history.length, 5);
});

test('chat context limits completed turns without pending messages consuming the window', () => {
  const history = Array.from({ length: 14 }, (_, i) => ({ id: i, role: 'user', status: 'saved' }));
  assert.deepEqual(chatContext(history).map(m => m.id), [4,5,6,7,8,9,10,11,12,13]);
});

test('Gemini honors configured model and supplies a default for empty configuration', () => {
  assert.equal(geminiModel({ GEMINI_MODEL: ' custom-model ' }), 'custom-model');
  assert.equal(geminiModel({ GEMINI_MODEL: ' ' }), 'gemini-2.5-flash');
  assert.equal(geminiModel({}), 'gemini-2.5-flash');
});
