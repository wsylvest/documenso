# Security Policy

SR Sign handles legally binding documents for SmartRoofing AI customers, so security reports are taken seriously.

## Reporting a vulnerability

Report vulnerabilities privately. Do not open a public issue, discussion or pull request for a security report.

1. **Email** [support@smartroofing.ai](mailto:support@smartroofing.ai) with the affected URL or version, a clear
   description, steps to reproduce and the potential impact.
2. **GitHub private reporting**, if enabled for this repository: the "Report a vulnerability" button under the
   Security tab.

The same contact is published at <https://sign.smartroofing.ai/.well-known/security.txt>.

## Upstream project

SR Sign is a fork of [Documenso](https://github.com/documenso/documenso). If you can reproduce a problem on
unmodified upstream code, please also report it through
[Documenso's security policy](https://github.com/documenso/documenso/security/policy), because the fix has to land
there as well. This fork tracks upstream security fixes and applies them as soon as they are released.

## Scope

In scope: the application code in this repository and the SR Sign deployment at sign.smartroofing.ai.

Out of scope, because they belong to the operator's network and host configuration rather than the code:

- Server-side request forgery and other network-egress concerns on self-hosted infrastructure
- DNS rebinding and other DNS-level issues
- Rate limiting, denial of service and volumetric attacks
- TLS and certificate configuration, HTTP security headers and other reverse-proxy settings
- Findings that depend on insecure self-hosted infrastructure or misconfiguration

If you are unsure whether something is in scope, report it privately anyway.

## Supported versions

Security fixes are applied to the latest release of this fork. Run the current `main`.
