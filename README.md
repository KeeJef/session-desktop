# Session Desktop

[Download at getsession.org](https://getsession.org/download)

## Summary

Session integrates directly with [Oxen Service Nodes](https://docs.oxen.io/about-the-oxen-blockchain/oxen-service-nodes), which are a set of distributed, decentralized and Sybil resistant nodes. Service Nodes act as servers which store messages offline, and a set of nodes which allow for onion routing functionality obfuscating users IP Addresses. For a full understanding of how Session works, read the [Session Whitepaper](https://getsession.org/whitepaper).
<br/><br/>
![DesktopSession](https://i.imgur.com/ydVhH00.png)

## Want to Contribute? Found a Bug or Have a feature request?

Please search for any [existing issues](https://github.com/session-foundation/session-desktop/issues) that describe your bug in order to avoid duplicate submissions. <br><br>Submissions can be made by making a pull request to our development branch.If you don't know where to start contributing please read [Contributing.md](CONTRIBUTING.md) and refer to issues tagged with the [Good-first-issue](https://github.com/session-foundation/session-desktop/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22) tag.

## Supported platforms

Session requires Windows 10 or later, macOS Ventura (13) or later, or a Linux distribution with glibc 2.28 or later like Debian 10 or Ubuntu 20.04.

## Build instruction

Build instructions can be found in [Contributing.md](CONTRIBUTING.md).

## Verifying signatures

**Step 1:**

Add Jason's GPG key. Jason Rhinelander, a member of the [Session Technology Foundation](https://session.foundation/) and is the current signer for all Session Desktop releases. His GPG key can be found on his GitHub and other sources.

```
wget https://github.com/jagerman.gpg
gpg --import jagerman.gpg
```

**Step 2:**

Get the signed hashes for this release. `SESSION_VERSION` needs to be updated for the release you want to verify.

```
export SESSION_VERSION=1.14.5
wget "https://github.com/session-foundation/session-desktop/releases/download/v$SESSION_VERSION/signature.asc"
```

**Step 3:**

Verify the signature of the hashes of the files.

```
gpg --verify signature.asc 2>&1 |grep "Good signature from"
```

The command above should print "`Good signature from "Jason Rhinelander...`". If it does, the hashes are valid but we still have to make the sure the signed hashes match the downloaded files.

**Step 4:**

Make sure the two commands below return the same hash for the file you are checking. If they do, file is valid.

```
sha256sum session-desktop-linux-x86_64-$SESSION_VERSION.AppImage
grep $SESSION_VERSION.AppImage signature.asc
```

## Debian repository

Please visit https://deb.oxen.io/<br/>

## License

Copyright 2011 Whisper Systems<br/>
Copyright 2013-2017 Open Whisper Systems<br/>
Copyright 2019-2024 The Oxen Project<br/>
Copyright 2014-2025 Session Technology Foundation<br/>
Licensed under the GPLv3: https://www.gnu.org/licenses/gpl-3.0.html<br/>

## Attributions

The IP-to-country mapping data used in this project is provided by [MaxMind GeoLite2](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data).

This project uses the [Lucide Icon Font](https://lucide.dev/), which is licensed under the [ISC License](./third_party_licenses/LucideLicense.txt).
