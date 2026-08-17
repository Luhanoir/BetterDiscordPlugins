/**
 * @name AutoPlayGifs
 * @version 7.0.0
 * @author BTS
 * @description Automatically plays animated Discord avatars, icons, and emoji.
 */

module.exports = class AutoPlayGifs {
    constructor() {
        this.observer = null;
        this.queue = new Set();
        this.frame = null;
        this.bodyTimer = null;
        this.seen = new WeakMap();
        this.restore = new Set();
    }

    start() {
        this.watch();
        this.add(document.body);
    }

    stop() {
        if (this.observer) this.observer.disconnect();
        if (this.frame) cancelAnimationFrame(this.frame);
        if (this.bodyTimer) clearTimeout(this.bodyTimer);

        this.observer = null;
        this.frame = null;
        this.bodyTimer = null;
        this.queue.clear();
        this.restoreAll();
    }

    watch() {
        if (!document.body) {
            this.bodyTimer = setTimeout(() => this.watch(), 500);
            return;
        }

        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === "childList") {
                    for (const node of mutation.addedNodes) this.add(node);
                    continue;
                }

                if (mutation.type === "attributes") this.add(mutation.target);
            }
        });

        this.observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["src", "srcset", "style"]
        });
    }

    add(node) {
        if (!node) return;
        this.queue.add(node);

        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
            const nodes = Array.from(this.queue);
            this.queue.clear();
            this.frame = null;

            for (const pending of nodes) this.scan(pending);
        });
    }

    scan(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

        this.process(node);

        if (typeof node.querySelectorAll !== "function") return;
        const elements = node.querySelectorAll("img[src], img[srcset], source[srcset], [style]");
        for (const element of elements) this.process(element);
    }

    process(element) {
        if (element instanceof HTMLImageElement) {
            this.patch(element, "src");
            this.patch(element, "srcset", (value) => this.srcset(value));
        }
        else if (element instanceof HTMLSourceElement) {
            this.patch(element, "srcset", (value) => this.srcset(value));
        }

        if (element.hasAttribute("style")) {
            this.patch(element, "style", (value) => this.style(value));
        }
    }

    patch(element, attribute, transformer = (value) => this.url(value)) {
        const current = element.getAttribute(attribute);
        if (!current) return;

        const next = transformer(current);
        if (!next || next === current) return;

        this.remember(element, attribute, current, next);
        element.setAttribute(attribute, next);
    }

    remember(element, attribute, original, rewritten) {
        let states = this.seen.get(element);

        if (!states) {
            states = new Map();
            this.seen.set(element, states);
        }

        let record = states.get(attribute);

        if (!record) {
            // Only put back attributes we changed and Discord has not replaced since.
            record = {element, attribute, original, rewritten};
            states.set(attribute, record);
            this.restore.add(record);
            return;
        }

        if (original !== record.rewritten) record.original = original;
        record.rewritten = rewritten;
    }

    restoreAll() {
        for (const record of this.restore) {
            if (record.element.getAttribute(record.attribute) === record.rewritten) {
                record.element.setAttribute(record.attribute, record.original);
            }
        }

        this.seen = new WeakMap();
        this.restore.clear();
    }

    srcset(value) {
        return value.split(",").map((candidate) => {
            const trimmed = candidate.trim();
            if (!trimmed) return trimmed;

            const [url, ...descriptor] = trimmed.split(/\s+/);
            return [this.url(url), ...descriptor].join(" ");
        }).join(", ");
    }

    style(value) {
        return value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (match, quote, url) => {
            const rewritten = this.url(url);
            return rewritten === url ? match : `url(${quote}${rewritten}${quote})`;
        });
    }

    url(value) {
        let url;

        try {
            url = new URL(value, location.href);
        }
        catch {
            return value;
        }

        if (!this.isDiscordCdn(url)) return value;

        const asset = this.getAsset(url);
        if (!asset) return value;

        return asset.animated ? this.animate(url, value) : value;
    }

    isDiscordCdn(url) {
        return /(^|\.)discordapp\.(?:com|net)$/i.test(url.hostname)
            || /(^|\.)discord\.com$/i.test(url.hostname);
    }

    getAsset(url) {
        const segments = url.pathname.split("/").filter(Boolean);

        if (segments[0] === "avatars") {
            return {type: "avatar", animated: this.hasAnimatedHash(segments[2])};
        }

        if (segments[0] === "guilds" && segments[2] === "users" && segments[4] === "avatars") {
            return {type: "avatar", animated: this.hasAnimatedHash(segments[5])};
        }

        if (segments[0] === "icons") {
            return {type: "guildIcon", animated: this.hasAnimatedHash(segments[2])};
        }

        if (segments[0] === "banners" || segments[0] === "splashes" || segments[0] === "discovery-splashes") {
            return {type: "guildIcon", animated: this.hasAnimatedHash(segments[2])};
        }

        if (segments[0] === "emojis") {
            return {type: "emoji", animated: true};
        }

        return null;
    }

    hasAnimatedHash(hashWithExtension = "") {
        return /^a_/i.test(hashWithExtension.replace(/\.(?:avif|gif|jpe?g|png|webp)$/i, ""));
    }

    animate(url, original) {
        const rewritten = new URL(url.href);

        rewritten.pathname = rewritten.pathname.replace(/\.(?:avif|gif|jpe?g|png|webp)$/i, ".webp");
        rewritten.searchParams.set("animated", "true");

        return this.sameShape(original, rewritten);
    }

    sameShape(original, rewritten) {
        if (original.startsWith("//")) return `//${rewritten.host}${rewritten.pathname}${rewritten.search}${rewritten.hash}`;
        if (/^https?:\/\//i.test(original)) return rewritten.href;
        return `${rewritten.pathname}${rewritten.search}${rewritten.hash}`;
    }
};
