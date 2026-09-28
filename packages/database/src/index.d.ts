export * from '@prisma/client';
declare const prismaClientSingleton: () => any;
declare global {
    var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}
export declare const db: any;
