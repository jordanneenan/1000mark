# Security

If you find a security problem in 1000Mark, please report it privately through GitHub: on this repository's **Security** tab, choose **Report a vulnerability**. Please do not open a public issue for it.

Include what you found, how to reproduce it, and what someone could do with it. You will get a reply, and a fix will be made as quickly as the problem calls for.

Please do not test against other people's accounts or data, run automated scans that slow the site down, or try to read stored data. Testing against your own copy on your own computer, as CONTRIBUTING.md describes, is fine.

## How the site protects people

- Passwords are hashed with scrypt; they are never stored or logged.
- Emails are stored encrypted (AES-256-GCM). The keys are kept apart from the database and are not in this repository.
- No IP addresses are stored. Sessions are random tokens of which only a hash is kept.
- Sign-in is protected by a proof-of-work bot check, rate limits and escalating account locks.
- The computer test sends only hardware names and sizes and test results. Run it with `--show-data` to see exactly what it sends.
