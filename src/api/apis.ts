export * from './defaultApi';

export class HttpError extends Error {
    constructor(public response: any, public body: any, public statusCode: number) {
        super(`HTTP error ${statusCode}`);
    }
}

export type RequestFile = {
    data: Buffer;
    name: string;
};
