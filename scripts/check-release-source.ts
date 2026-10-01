import { $ } from 'bun';
import { platforms, releaseTag, repository } from './release-lib';
const tag = releaseTag();
const id = process.env.ARTIFACT_RUN_ID || '';
if (!/^\d+$/.test(id)) throw new Error('Expected a numeric artifact run ID.');
const run = JSON.parse(await $`gh run view ${id} --repo ${repository} --json event,headSha,headBranch,workflowName,jobs`.text());
const revision = (await $`git rev-list -n 1 ${tag}`.text()).trim();
if (run.event !== 'push' || run.headBranch !== tag || run.headSha !== revision || run.workflowName !== 'Release') {
  throw new Error('Artifacts must come from the original Release run for this exact version tag.');
}
const successful = run.jobs.filter((job: { conclusion: string }) => job.conclusion === 'success');
if (!successful.some((job: { name: string }) => job.name === 'pack') ||
    !platforms.every(platform => successful.some((job: { name: string }) => job.name.startsWith('binaries (') && job.name.endsWith(', ' + platform + ')')))) {
  throw new Error('The source run must have passed npm packing and all configured native binary jobs.');
}
console.log('Verified release artifacts source: ' + revision);
