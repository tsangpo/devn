import { verifyArchive } from './release-lib';
const archive = process.argv[2];
if (!archive) throw new Error('Specify a release archive.');
await verifyArchive(archive);
console.log('Release archive SHA-256 verified.');
