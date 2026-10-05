import { EngineTransportError } from './engine-transport.error';

/**
 * An {@link EngineTransportError} (HTTP 503) for a send that failed in transport before the message was
 * handed to WhatsApp, such as a lookup the send depends on timing out. Like a throttled request, nothing
 * went out, while a plain EngineTransportError leaves the outcome unknown, so a paced send can give its
 * admission back.
 */
export class EngineNotSentError extends EngineTransportError {}
