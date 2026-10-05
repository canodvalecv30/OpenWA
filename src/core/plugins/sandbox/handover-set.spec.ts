import { dispatchCapabilityVerb } from './capability-router';

it('routes handover.set to context.handover.set with (key, state)', async () => {
  const set = jest.fn().mockResolvedValue(undefined);
  const key = { sessionId: 's', chatId: 'c', instanceId: 'i' };
  await dispatchCapabilityVerb({ handover: { set } } as never, 'handover.set', [key, 'human']);
  expect(set).toHaveBeenCalledWith(key, 'human');
});

it('rejects a handover.set state outside bot/human/closed before it reaches the context', async () => {
  const set = jest.fn().mockResolvedValue(undefined);
  const key = { sessionId: 's', chatId: 'c', instanceId: 'i' };
  for (const state of ['Human', 'human ', null, 1]) {
    await expect(dispatchCapabilityVerb({ handover: { set } } as never, 'handover.set', [key, state])).rejects.toThrow(
      "Capability handover.set: argument 1 must be 'bot', 'human' or 'closed'",
    );
  }
  expect(set).not.toHaveBeenCalled();
});
