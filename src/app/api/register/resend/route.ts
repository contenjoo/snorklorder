import {POST as register} from '../route';
// Reuses registration's IP and per-address limits, and never changes verified accounts.
export const POST=register;
