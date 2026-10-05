import { BadRequestException } from '@nestjs/common';
import { CallService } from './call.service';
import { EngineRegistry } from '../../engine/engine-registry.service';
import { IWhatsAppEngine } from '../../engine/interfaces/whatsapp-engine.interface';
import { CallNotFoundError } from '../../common/errors/call-not-found.error';

describe('CallService', () => {
  const makeService = (engine: Partial<IWhatsAppEngine> | undefined) => {
    const engines = new EngineRegistry();
    if (engine) engines.set('s1', engine as IWhatsAppEngine);
    return new CallService(engines);
  };

  it('throws 400 "Session is not started" when the engine is missing (guard preserved)', () => {
    // The guard throws synchronously; the controller method is `async`, so this still surfaces
    // as a rejected promise -> 400 at the HTTP layer (same shape as GroupService).
    const svc = makeService(undefined);
    expect(() => svc.rejectCall('s1', 'CALL1')).toThrow(BadRequestException);
    expect(() => svc.rejectCall('s1', 'CALL1')).toThrow('Session is not started');
  });

  it('delegates rejectCall to the engine when the session is started', async () => {
    const rejectCall = jest.fn().mockResolvedValue(undefined);
    const svc = makeService({ rejectCall });
    await svc.rejectCall('s1', 'CALL1');
    expect(rejectCall).toHaveBeenCalledWith('CALL1');
  });

  it('delegates createCallLink to the engine with the type and epoch-ms startTime', async () => {
    const createCallLink = jest.fn().mockResolvedValue('https://call.whatsapp.com/voice/L');
    const svc = makeService({ createCallLink });
    await expect(svc.createCallLink('s1', 'audio', 1_800_000_000_000)).resolves.toBe(
      'https://call.whatsapp.com/voice/L',
    );
    expect(createCallLink).toHaveBeenCalledWith('audio', 1_800_000_000_000);
  });

  it('guards createCallLink with the same 400 when the engine is missing', () => {
    expect(() => makeService(undefined).createCallLink('s1', 'video', 1)).toThrow('Session is not started');
  });

  it('propagates the engine not-found error (unknown/expired call id -> 404)', async () => {
    const rejectCall = jest.fn().mockRejectedValue(new CallNotFoundError('CALL1'));
    const svc = makeService({ rejectCall });
    await expect(svc.rejectCall('s1', 'CALL1')).rejects.toBeInstanceOf(CallNotFoundError);
  });
});
