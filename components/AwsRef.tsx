/**
 * AwsRef — an AWS identifier you can actually look up.
 *
 * Every account ID, ARN and resource name this console prints comes from a
 * synthetic scenario pack. All twelve packs live in `123456789012`, the account
 * AWS itself uses in its documentation, and none of those roles, buckets, secrets
 * or snapshots exist anywhere. So this component deliberately does **not** link
 * into the AWS console: the page would 404, and a console-shaped link is exactly
 * the affordance that makes simulated data read as live infrastructure.
 *
 * What it links to instead is the AWS documentation for the service the
 * identifier belongs to — the page that states what `s3:PutBucketPolicy` or a
 * publicly shared RDS snapshot actually permits, which is the thing worth
 * checking when reading an attack path.
 */

import React from 'react';
import { BookOpen } from 'lucide-react';

type DocTarget = { service: string; label: string; href: string };

/**
 * One entry per AWS service that appears in the scenario packs. Every URL here
 * was fetched and confirmed live; unknown services fall back to the ARN
 * reference rather than a guessed deep link.
 */
const DOCS: Record<string, DocTarget> = {
  iam: {
    service: 'AWS Identity and Access Management',
    label: 'IAM roles',
    href: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html',
  },
  sts: {
    service: 'AWS Security Token Service',
    label: 'Assuming a role (temporary credentials)',
    href: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html',
  },
  s3: {
    service: 'Amazon Simple Storage Service',
    label: 'S3 bucket policies',
    href: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-policies.html',
  },
  secretsmanager: {
    service: 'AWS Secrets Manager',
    label: 'What Secrets Manager protects',
    href: 'https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html',
  },
  kms: {
    service: 'AWS Key Management Service',
    label: 'KMS keys and key policies',
    href: 'https://docs.aws.amazon.com/kms/latest/developerguide/overview.html',
  },
  rds: {
    service: 'Amazon Relational Database Service',
    label: 'Sharing a DB snapshot',
    href: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ShareSnapshot.html',
  },
  lambda: {
    service: 'AWS Lambda',
    label: 'Lambda documentation',
    href: 'https://docs.aws.amazon.com/lambda/index.html',
  },
  ec2: {
    service: 'Amazon Elastic Compute Cloud',
    label: 'Instance Metadata Service (IMDS)',
    href: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html',
  },
  cloudtrail: {
    service: 'AWS CloudTrail',
    label: 'CloudTrail log file integrity validation',
    href: 'https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-log-file-validation-intro.html',
  },
};

/** Fallback for any ARN whose service has no curated page, and for malformed input. */
const ARN_REFERENCE: DocTarget = {
  service: 'Amazon Resource Names',
  label: 'ARN format and namespaces',
  href: 'https://docs.aws.amazon.com/general/latest/gr/aws-arns-and-namespaces.html',
};

const ACCOUNT_REFERENCE: DocTarget = {
  service: 'AWS account identifiers',
  label: 'AWS account identifiers',
  href: 'https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-identifiers.html',
};

/** The account every scenario pack pretends to be. Documented by AWS as an example. */
export const SYNTHETIC_ACCOUNT_ID = '123456789012';

const ARN_SERVICE = /^arn:aws[s]?:(\w[\w-]*):/;
const ACCOUNT_ID = /^\d{12}$/;

/** Last meaningful segment of an ARN, safe on undefined/odd input (hostile payloads included). */
export function shortArn(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0) return '—';
  const tail = value.split('/').pop() ?? value;
  return tail.split(':').pop() || value;
}

/**
 * Best-effort service guess for identifiers that carry no ARN prefix — remediation
 * parameters name a bucket or a role without saying which service owns it.
 * Returns undefined rather than guessing wrong, and the link then points at the
 * ARN reference.
 */
export function serviceHintFromKey(key: string): string | undefined {
  const k = String(key).toLowerCase();
  if (k.includes('bucket')) return 's3';
  if (k.includes('snapshot') || k.includes('db')) return 'rds';
  if (k.includes('secret')) return 'secretsmanager';
  if (k.includes('kms') || /(^|_)keys?$/.test(k)) return 'kms';
  if (k.includes('topic') || k.includes('queue')) return 'sqs';
  if (k.includes('role') || k.includes('user') || k.includes('policy') || k.includes('principal')) return 'iam';
  if (k.includes('instance')) return 'ec2';
  if (k.includes('function')) return 'lambda';
  return undefined;
}

/** Resolves the documentation target for an identifier. Exported for tests. */
export function awsDocFor(value: string, hint?: string): DocTarget {
  if (ACCOUNT_ID.test(value)) return ACCOUNT_REFERENCE;
  const service = value.match(ARN_SERVICE)?.[1] ?? hint;
  return (service && DOCS[service]) || ARN_REFERENCE;
}

/** Why this link goes to docs and not the console — stated on every reference. */
function noteFor(value: string, doc: DocTarget): string {
  const origin =
    ACCOUNT_ID.test(value) && value === SYNTHETIC_ACCOUNT_ID
      ? `${SYNTHETIC_ACCOUNT_ID} is the example account AWS uses in its own documentation — every scenario pack here runs inside it, so nothing exists at this ID`
      : 'this identifier comes from a synthetic scenario pack, so no live resource matches it';
  return `${doc.service} · synthetic identifier: ${origin}. Opens AWS documentation, not the AWS console.`;
}

interface AwsRefProps {
  /** The full identifier (ARN, account ID, bucket or role name). */
  value: string | null | undefined;
  /** Display text; defaults to the full value. Truncated upstream where space is tight. */
  label?: string;
  /** Service key for identifiers that carry no ARN prefix (bare role or bucket names). */
  service?: string;
  className?: string;
}

export function AwsRef({ value, label, service, className = '' }: AwsRefProps) {
  if (typeof value !== 'string' || value.length === 0) return <>—</>;

  const doc = awsDocFor(value, service);
  const text = label && label.length > 0 ? label : value;

  return (
    <a
      className={`awsref ${className}`.trim()}
      href={doc.href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${value} — ${noteFor(value, doc)}`}
      aria-label={`${text} — synthetic ${doc.service} identifier, opens AWS documentation`}
      data-aws-service={doc.service}
    >
      <span className="awsref__text">{text}</span>
      <BookOpen className="awsref__icon" size={11} aria-hidden="true" />
    </a>
  );
}

export default AwsRef;
