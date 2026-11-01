import type { IpcError } from './contract';

export class IpcFailure extends Error implements IpcError {
  readonly code: IpcError['code'];
  readonly details?: IpcError['details'];
  constructor(error: IpcError) {
    super(error.message);
    this.name = 'IpcFailure';
    this.code = error.code;
    this.details = error.details;
  }
}
