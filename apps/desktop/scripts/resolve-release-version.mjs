#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export function resolveReleaseVersion(input) {
	const {
		packageVersion,
		eventName,
		inputTag,
		inputTarget,
		refName,
		refType,
		headSha,
		previousVersion,
	} = input;
	let shouldRelease = true;
	let tag;

	if (eventName === 'workflow_dispatch') {
		tag = inputTag;
	} else if (refType === 'tag') {
		tag = refName;
	} else {
		tag = `v${packageVersion}`;
		if (previousVersion === packageVersion) {
			shouldRelease = false;
		}
	}

	if (!tag?.startsWith('v')) {
		throw new Error(`Tag '${tag ?? ''}' must start with 'v'.`);
	}
	const version = tag.slice(1);
	if (version !== packageVersion) {
		throw new Error(`Tag ${tag} does not match desktop package version ${packageVersion}.`);
	}

	return { shouldRelease, tag, target: inputTarget || headSha, version };
}

function gitOutput(args) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function readPreviousVersion(beforeSha) {
	if (!beforeSha || /^0+$/.test(beforeSha)) {
		return undefined;
	}
	try {
		return JSON.parse(gitOutput(['show', `${beforeSha}:apps/desktop/package.json`])).version;
	} catch {
		return undefined;
	}
}

function run() {
	const targetCandidate = process.env.INPUT_TARGET || process.env.HEAD_SHA;
	const target = gitOutput(['rev-parse', '--verify', `${targetCandidate}^{commit}`]);
	const packageVersion = JSON.parse(
		gitOutput(['show', `${target}:apps/desktop/package.json`]),
	).version;
	const cliVersion = JSON.parse(gitOutput(['show', `${target}:apps/cli/package.json`])).version;
	const lockPackages = JSON.parse(gitOutput(['show', `${target}:package-lock.json`])).packages;
	const lockVersion = lockPackages['apps/desktop'].version;
	const cliLockVersion = lockPackages['apps/cli'].version;
	if (lockVersion !== packageVersion) {
		throw new Error(
			`Desktop package version ${packageVersion} does not match lockfile version ${lockVersion}.`,
		);
	}
	if (cliVersion !== packageVersion || cliLockVersion !== packageVersion) {
		throw new Error(
			`Desktop package version ${packageVersion} must match CLI package ${cliVersion} and CLI lockfile ${cliLockVersion}.`,
		);
	}
	const branchPush =
		process.env.EVENT_NAME !== 'workflow_dispatch' && process.env.REF_TYPE !== 'tag';
	const result = resolveReleaseVersion({
		packageVersion,
		eventName: process.env.EVENT_NAME,
		inputTag: process.env.INPUT_TAG,
		inputTarget: target,
		refName: process.env.REF_NAME,
		refType: process.env.REF_TYPE,
		headSha: target,
		...(branchPush ? { previousVersion: readPreviousVersion(process.env.BEFORE_SHA) } : {}),
	});
	const output = [
		`should-release=${result.shouldRelease}`,
		`tag=${result.tag}`,
		`target=${result.target}`,
		`version=${result.version}`,
	].join('\n');
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
	} else {
		console.log(output);
	}
}

if (process.argv[1]?.endsWith('resolve-release-version.mjs')) {
	run();
}
