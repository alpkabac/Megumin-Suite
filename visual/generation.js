/* eslint-disable no-undef */

export function createVisualGeneration(api) {
    const {
        extensionName,
        extensionFolderPath,
        TARGET_PRESET_NAME,
        getContext,
        getCharacterKey,
        saveProfileToMemory,
        useMeguminEngine,
        substituteParams,
        generateQuietPrompt,
        getRequestHeaders,
        saveChat,
        reloadCurrentChat,
        addOneMessage,
        appendMediaToMessage,
        saveBase64AsFile,
        humanizedDateTime,
        Popup,
        POPUP_TYPE,
        KAZUMA_PLACEHOLDERS,
        RESOLUTIONS,
        extension_settings,
        eventSource,
        event_types,
    } = api;

    const getLocalProfile = api.getLocalProfile;

    let activeImageGenRequest = null;
    let activeVideoGenRequest = null;
    let activeLoraAssignRequest = null;
    let activeVideoGenJob = false;
    let activeManualImageScene = null;
    const completedVideoPromptIds = new Set();
    const backgroundImageQueue = [];
    const backgroundOriginKeys = new Set();
    let backgroundImageWorkerActive = false;
    let backgroundActiveJob = null;
    let danbooruTagsMap = null;
    let civitaiKeywordCache = {};

    const NSFW_POSITION_PRESETS = [
        { label: "None", prompt: "" },
        { label: "Missionary", prompt: "missionary position, face-to-face intimacy, bodies close together, natural hip movement" },
        { label: "Cowgirl", prompt: "cowgirl position, partner on top, straddling hips, rhythmic motion, intimate eye contact" },
        { label: "Reverse Cowgirl", prompt: "reverse cowgirl position, partner on top facing away, arched back, rhythmic hip movement" },
        { label: "Doggy Style", prompt: "doggy style position, from-behind angle, hands on hips, dynamic thrusting motion" },
        { label: "Spooning", prompt: "spooning position, side-by-side bodies, intimate close contact, slow sensual movement" },
        { label: "Lotus", prompt: "lotus position, seated face-to-face embrace, legs wrapped, close kissing and grinding motion" },
        { label: "Standing", prompt: "standing position, bodies pressed together, lifted leg, passionate movement" },
        { label: "Against Wall", prompt: "against the wall position, pinned close together, one leg raised, urgent passionate motion" },
        { label: "Legs Over Shoulders", prompt: "legs over shoulders position, deep intimate angle, close body contact, rhythmic motion" },
        { label: "Mating Press", prompt: "mating press position, knees pushed up, intense close body contact, passionate thrusting" },
        { label: "Oral 69", prompt: "69 position, mutual pleasure, intertwined bodies, intimate sensual movement" },
        { label: "Blowjob", prompt: "blowjob, kneeling pose, intimate close-up, sensual mouth movement" },
        { label: "Deepthroat", prompt: "deepthroat, kneeling pose, intense intimate close-up, rhythmic mouth movement" },
        { label: "Face Sitting", prompt: "face sitting position, partner seated over face, intimate sensual movement" },
        { label: "Cunnilingus", prompt: "cunnilingus, thighs parted, intimate close-up, sensual licking motion" },
        { label: "Titfuck", prompt: "titfuck, breasts pressed around penis, intimate close-up, rhythmic sliding motion" },
        { label: "Footjob", prompt: "footjob, feet wrapped around penis, intimate close-up, rhythmic stroking motion" },
        { label: "Handjob", prompt: "handjob, hand wrapped around penis, intimate close-up, rhythmic stroking motion" },
        { label: "Fingering", prompt: "fingering, intimate close-up, hand between thighs, sensual finger motion" },
        { label: "Grinding", prompt: "clothed or nude grinding, hips pressed together, rhythmic friction, close body contact" },
        { label: "Lap Dance", prompt: "lap dance, straddling lap, teasing hip movement, intimate close body contact" },
        { label: "Riding Face", prompt: "riding face, thighs around head, partner on top, intimate sensual movement" },
        { label: "Standing Oral", prompt: "standing oral position, kneeling partner, intimate close-up, sensual mouth movement" },
        { label: "Anal", prompt: "intimate from-behind angle, close body contact, rhythmic thrusting motion" },
        { label: "Double Penetration", prompt: "double penetration, three adult participants, intense close body contact, synchronized rhythmic motion" },
        { label: "Threesome", prompt: "threesome, three adult participants, intertwined bodies, shared intimate motion" },
        { label: "Paizuri POV", prompt: "paizuri, first-person perspective, breasts pressed around penis, rhythmic sliding motion" }
    ];

    const DEFAULT_BACKGROUND_AUTOMATION = {
        autoEnabled: false,
        autoTriggerMode: "explicit",
        autoRandomChance: 20,
        cooldownReplies: 3,
        smartEnabled: false,
        qwenUrl: "http://127.0.0.1:8080/v1/chat/completions",
        qwenModel: "Qwen2-0.5B-Instruct",
        qwenTimeoutMs: 30000,
        qwenMinConfidence: 0.7,
        smartSearchLibrary: true,
        smartGenerateFallback: true,
        qwenStatus: "Idle",
        qwenStatusAt: 0,
        lastProcessedRevisionKey: "",
        lastProcessedMessageIndex: -1,
        batchEnabled: false,
        panelOpen: false,
        queuePaused: false,
        batchPositions: ["Missionary", "Cowgirl", "Doggy Style", "Spooning", "Blowjob", "Cunnilingus"],
        batchMaleAnatomy: "huge",
        batchImagesPerGroup: 1,
        batchLibraryOpen: false,
        library: [],
        lastAutoAiCount: 0
    };

    function ensureBackgroundAutomationSettings(s) {
        if (!s.backgroundAutomation || typeof s.backgroundAutomation !== "object") {
            s.backgroundAutomation = JSON.parse(JSON.stringify(DEFAULT_BACKGROUND_AUTOMATION));
        }
        for (const [key, value] of Object.entries(DEFAULT_BACKGROUND_AUTOMATION)) {
            if (s.backgroundAutomation[key] === undefined) {
                s.backgroundAutomation[key] = Array.isArray(value) ? [...value] : value;
            }
        }
        if (!Array.isArray(s.backgroundAutomation.batchPositions)) s.backgroundAutomation.batchPositions = [...DEFAULT_BACKGROUND_AUTOMATION.batchPositions];
        if (!Array.isArray(s.backgroundAutomation.library)) s.backgroundAutomation.library = [];
        return s.backgroundAutomation;
    }

    function getBatchLibraryFilename(item) {
        if (item?.filename) return String(item.filename);
        const url = String(item?.url || "").split(/[?#]/)[0];
        const name = url.split(/[\\/]/).filter(Boolean).pop();
        return name || item?.id || "unnamed image";
    }

    function getBatchLibraryPrimaryCharacter(item) {
        return String(item?.primaryCharacter || item?.characters?.[0] || "Unknown character");
    }

    function buildBatchLibraryInventoryHtml(automation) {
        const batchItems = automation.library.filter(item => item?.source === "batch" || item?.batchKey);
        if (!batchItems.length) {
            return '<div style="font-size:.7rem; color:var(--text-muted); padding:10px; text-align:center;">No batch images generated yet.</div>';
        }
        const groups = new Map();
        for (const item of batchItems) {
            const character = getBatchLibraryPrimaryCharacter(item);
            const position = String(item.position || "Uncategorized");
            if (!groups.has(character)) groups.set(character, new Map());
            const positionGroups = groups.get(character);
            if (!positionGroups.has(position)) positionGroups.set(position, []);
            positionGroups.get(position).push(item);
        }
        return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([character, positions]) => `
            <details style="border:1px solid var(--border-color); border-radius:7px; background:rgba(0,0,0,.14);">
                <summary style="cursor:pointer; padding:9px 10px; font-size:.73rem; font-weight:800;">${psEscapeText(character)} <span style="color:var(--text-muted); font-weight:500;">(${[...positions.values()].reduce((n, items) => n + items.length, 0)})</span></summary>
                <div style="padding:0 9px 9px; display:flex; flex-direction:column; gap:7px;">
                    ${[...positions.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([position, items]) => `
                        <div style="border:1px solid rgba(255,255,255,.07); border-radius:7px; padding:8px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
                                <span style="font-size:.7rem; font-weight:800; color:#c084fc;">${psEscapeText(position)} <span style="color:var(--text-muted); font-weight:500;">(${items.length})</span></span>
                                <div style="display:flex; gap:5px;">
                                    <button type="button" class="ps-modern-btn secondary ig-batch-group-add" data-character="${psEscapeAttr(character)}" data-position="${psEscapeAttr(position)}" style="padding:4px 9px; font-size:.65rem;"><i class="fa-solid fa-plus"></i> Add ${Math.max(1, parseInt(automation.batchImagesPerGroup, 10) || 1)}</button>
                                    <button type="button" class="ps-modern-btn secondary ig-batch-group-delete" data-character="${psEscapeAttr(character)}" data-position="${psEscapeAttr(position)}" title="Remove this group from the Batch Library index. Saved files remain on disk." style="padding:4px 8px; font-size:.65rem; color:#ef4444;"><i class="fa-solid fa-trash"></i></button>
                                </div>
                            </div>
                            <div style="display:flex; flex-direction:column; gap:3px;">
                                ${items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(item => `
                                    <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                                        <span title="${psEscapeAttr(item.url || "")}" style="flex:1; min-width:0; font-family:Consolas,monospace; font-size:.65rem; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${psEscapeText(getBatchLibraryFilename(item))}</span>
                                        <button type="button" class="ig-batch-item-delete" data-library-id="${psEscapeAttr(item.id || "")}" title="Remove from Batch Library index. Saved file remains on disk." style="border:0; background:transparent; color:#ef4444; cursor:pointer; padding:2px 4px;"><i class="fa-solid fa-xmark"></i></button>
                                    </div>
                                `).join("")}
                            </div>
                        </div>
                    `).join("")}
                </div>
            </details>
        `).join("");
    }

    function refreshBatchLibraryInventory() {
        const s = getLocalProfile()?.imageGen;
        if (!s) return;
        const automation = ensureBackgroundAutomationSettings(s);
        $("#ig_bg_batch_library_body").html(buildBatchLibraryInventoryHtml(automation));
        $("#ig_bg_batch_library_count").text(`${automation.library.filter(item => item?.source === "batch" || item?.batchKey).length} images`);
    }

    const IMAGE_SCENE_FIDELITY_INSTRUCTION = "Scene fidelity: derive the image from the latest visible moment in the chat, not a generic mood. Preserve who is present, subject count, body placement, role/orientation, pose, contact points, clothing/nudity state, expression, camera angle, and setting. For adult/NSFW scenes, name the specific position or act when it is present in the chat or Extra field, and use concrete visual staging instead of vague terms like intimate, sensual, passionate, or suggestive. Do not swap to an unrelated pose, solo portrait, pinup, or aftermath unless the chat actually says so.";

    const IMAGE_ADULT_TAG_PRECISION_INSTRUCTION = "Adult tag precision: if the scene is explicit and all visible participants are adults, use direct visual tags and concrete staging instead of euphemisms. Use exact terms when they match the scene: naked, nude, topless, exposed nipples, erection, hetero, sex, vaginal, anal, oral, fellatio, cunnilingus, paizuri, straddling, riding, missionary, doggystyle, cowgirl position, moaning, open mouth, tongue out, flushed face, heavy breathing, trembling, saliva, sweat, cum, ejaculation, facial, cum inside. Do not add an explicit act that is not present in the chat or Extra field.";

    const Z_IMAGE_PROMPT_INSTRUCTION = "Z-Image LoRA format: output one compact, concrete natural-language description, usually one dense paragraph. You may open with a short medium or camera phrase such as 'Photograph of', 'Digital illustration of', or 'Perspective: bird's-eye view'. Then describe visible subjects one by one, keeping each subject's placement, pose, expression, state, and action attached to that subject. State exact spatial relationships and visible contact points. Finish with the setting, background details, lighting, lens or focus when relevant. Let the prompt model choose coherent appearance and clothing details when the current scene does not specify them. Do not import character booru tags or stored appearance descriptions. When exact LoRA activation keywords are supplied, reproduce each keyword exactly once without translating or expanding it into an appearance tag list. Prose is the default. Only when extra precision would materially help—especially for a complex explicit scene—you may finish with one short comma-separated suffix containing scene-specific act, position, penetration/contact, point-of-view, or camera cues. Do not force a suffix, do not repeat the prose, and never use it for character appearance tags, clothing tags, quality scores, or generic Danbooru filler. Prefer observable facts over mood and do not use underscore tokens or shorthand such as 1girl. Output contract: your entire response must be the single finished renderable image prompt. Begin immediately with the prompt itself. Never output analysis, scene notes, extracted details, requirements, plans, drafts, refinements, self-talk, explanations, labels such as Draft or Final Prompt, or a second version of the prompt. Do not describe what you are about to write and do not comment after writing it.";

    const Z_IMAGE_FORBIDDEN_MINOR_RE = /\b(?:child(?:ren)?|kids?|toddlers?|infants?|bab(?:y|ies)|minors?|underage|pre[ -]?teens?|teens?|teenagers?|teenaged?|adolescents?|juveniles?|child[ -]?like|young[ -]?looking|loli(?:con)?|shota(?:con)?|school[ -]?(?:girl|boy))\b/i;
    const Z_IMAGE_UNDER_18_AGE_RE = /\b(?:age[ :]*|aged[ ]+)?(?:[0-9]|1[0-7])[ -]?(?:years?[ -]?old|y\/?o)\b/i;
    const Z_IMAGE_SPELLED_UNDER_18_AGE_RE = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)[ -]years?[ -]old\b/i;

    function findZImageForbiddenMinorTerm(prompt) {
        const normalized = String(prompt || "").replace(/[_-]+/g, " ");
        const forbiddenMatch = normalized.match(Z_IMAGE_FORBIDDEN_MINOR_RE);
        if (forbiddenMatch) return forbiddenMatch[0];
        const ageMatch = normalized.match(Z_IMAGE_UNDER_18_AGE_RE);
        if (ageMatch) return ageMatch[0];
        const spelledAgeMatch = normalized.match(Z_IMAGE_SPELLED_UNDER_18_AGE_RE);
        return spelledAgeMatch ? spelledAgeMatch[0] : "";
    }

    function blockForbiddenZImagePrompt(prompt) {
        const forbidden = findZImageForbiddenMinorTerm(prompt);
        if (!forbidden) return false;
        $("#kazuma_progress_overlay").hide();
        toastr.error(`Z-Image prompt blocked: forbidden minor-related wording detected (${forbidden}).`);
        console.warn("[Megumin Suite] Z-Image minor guard blocked generated input:", forbidden);
        return true;
    }

    const Z_IMAGE_PROMPT_EXAMPLES = `Formatting references only. Never copy their people, appearance, clothing, setting, or acts into another scene; derive the actual content from the current chat and choose unspecified visual details yourself.

Photograph of two adult women in an outdoor hot tub. The woman sitting on the stone edge is nude, with her legs apart and her hair in a high ponytail. The second woman kneels in the clear, bubbling water between her legs. Their expressions, exact interaction, spatial arrangement, grassy surroundings, paved road, and bright natural sunlight are described directly and unambiguously.

A natural-light indoor photograph of an adult woman kneeling in front of an adult man. Her gaze, posture, hand placement, expression, their exact interaction, and the visible anatomical details are described concretely. A window and furniture remain softly blurred in the background while the subjects stay sharply defined.

Perspective: bird's-eye view, slight fisheye distortion, moderately wide-angle lens. A digital anime-style illustration of two adults on a crimson velvet couch. Describe the woman's pose and expression, the man's position behind her, their exact body contact and interaction, then the warm golden light and deep shadows shaping the scene.

Soft focus, gentle glow. A richly colored boudoir scene involving one adult woman and two adult men on a velvet bed. Establish each person's placement and action separately, keep faces or bodies obscured only where the scene requires it, and finish with the dark furnishings and crystal lamp in the dim background.

Deep focus, low-angle shot. A cool blue, neon-accented scene involving an adult woman and an adult man. Describe their gaze, posture, exact interaction, visible physical details, and tension in complete sentences, followed by the blue illumination and sharp focus.

For a spatially complex explicit scene only, an optional final cue suffix may look like: POV, [specific position], [specific act], [contact or penetration direction], looking over shoulder. Omit this line when the prose already makes the image unambiguous.`;

    function isNaturalLanguageImageStyle(style) {
        return style === "sdxl" || style === "zimage";
    }

    function buildImagePromptStructureRules(s, booruStd = false) {
        const style = s?.promptStyle || "standard";
        const perspective = s?.promptPerspective || "scene";
        const proseMode = isNaturalLanguageImageStyle(style) || booruStd;
        const modeLabel = perspective === "pov" ? "POV" : (perspective === "character" ? "portrait" : "cinematic scene");
        const outputType = proseMode ? "natural-language image prompt" : "comma-separated image prompt";
        const characterRule = proseMode
            ? "For multiple visible characters, dedicate a separate sentence to each character with clear spatial labels such as left, center, right, foreground, or behind. Keep each character's hair, eyes, body, clothing, expression, and action attached to that character only."
            : "For multiple visible characters, separate each character clearly with spatial labels such as left, center, right, foreground, or behind. Keep each character's appearance tags, expression, and action grouped together to prevent feature bleeding.";
        const perspectiveRule = perspective === "pov"
            ? "Establish first-person camera placement first. If the player is only observing, use an environmental foreground anchor; if the player is physically interacting, include visible hands/body cues only for the interaction. Do not invent the player's face."
            : (perspective === "character"
                ? "Keep the prompt focused on a single character portrait unless the chat clearly demands more people. Prioritize face, hair, body, clothing, expression, gaze, and simple background."
                : "Establish shot type, camera angle, subject count, pose/contact, environment, and lighting in that order.");
        return `Structured prompt rules (${modeLabel}): write a ${outputType}. Build it in this order: quality/style anchor, camera/perspective, visible character count, per-character appearance and current action, then setting and lighting. ${perspectiveRule} ${characterRule}`;
    }

    function buildImagePromptExamples(s, booruStd = false) {
        const style = s?.promptStyle || "standard";
        const perspective = s?.promptPerspective || "scene";
        const proseMode = isNaturalLanguageImageStyle(style) || booruStd;
        if (style === "zimage" && perspective === "pov") {
            return Z_IMAGE_PROMPT_EXAMPLES;
        }
        if (style === "zimage" && perspective === "character") {
            return Z_IMAGE_PROMPT_EXAMPLES;
        }
        if (style === "zimage") {
            return Z_IMAGE_PROMPT_EXAMPLES;
        }
        if (proseMode && perspective === "pov") {
            return "Example shape: A masterpiece in first-person point of view. The camera looks across rumpled sheets in the foreground toward two adult characters. On the left, [character A appearance, clothing/nudity state, expression, and action]. On the right, [character B appearance, clothing/nudity state, expression, and action]. The bedroom background, warm low lighting, and visible contact points match the current scene.";
        }
        if (proseMode && perspective === "character") {
            return "Example shape: A masterpiece portrait of one adult character. Describe age bracket, gender, species if relevant, skin, eyes, hair, body type, clothing or nudity state, expression, gaze, and a simple background with portrait lighting.";
        }
        if (proseMode) {
            return "Example shape: A cinematic masterpiece. A [shot type] shows [visible adult character count] in [setting]. The left character is described in one complete sentence. The right character is described in a separate complete sentence. Finish with pose/contact, environment, lighting, and mood from the exact scene.";
        }
        if (perspective === "pov") {
            return "Example shape: masterpiece, best quality, highly detailed, 1st person pov, foreground sheets visible, 1boy 1girl, left character: adult woman, [appearance tags], [expression], [action], foreground hands visible only if interacting, bedroom background, warm lighting, depth of field";
        }
        if (perspective === "character") {
            return "Example shape: masterpiece, best quality, highly detailed, portrait, upper body, 1girl, adult woman, [hair tags], [eye tags], [body tags], [clothing or nudity state], [expression], looking at viewer, simple background, soft lighting";
        }
        return "Example shape: masterpiece, best quality, highly detailed, cinematic composition, medium shot, 1boy 1girl, left character: adult man, [appearance tags], [expression], [action], right character: adult woman, [appearance tags], [expression], [action], exact pose/contact from scene, bedroom background, dramatic lighting";
    }

    function appendImagePromptInstruction(base, addition) {
        const text = String(addition || "").trim();
        if (!text) return base || "None";
        const current = base && base !== "None" ? String(base).trim() : "";
        return current ? `${current}\n${text}` : text;
    }

    function escapeRegex(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function ensureImageLeadPrefix(rawPrompt) {
        const s = getLocalProfile()?.imageGen;
        const raw = String(rawPrompt ?? "").trim();
        if (/^tags\s*:/i.test(raw)) return raw;
        let p = sanitizePromptTags(raw).trim();
        if (!s || !s.enabled) return p;
        const lead = buildBooruStandardTagLead(s, s.loraIntel);
        if (!lead) return p;
        const esc = escapeRegex(lead);
        if (new RegExp(`^${esc}\\s*,\\s*`).test(p) || p === lead) return p;
        return `${lead}, ${p}`;
    }

    async function loadDanbooruTags() {
        if (danbooruTagsMap) return danbooruTagsMap;
        try {
            const res = await fetch(`${extensionFolderPath}/tags.csv`);
            const text = await res.text();
            danbooruTagsMap = new Map();
            const lines = text.split('\n');
            for (const line of lines) {
                const firstComma = line.indexOf(',');
                if (firstComma === -1) continue;
                const tag = line.substring(0, firstComma).trim();
                if (tag) {
                    const rest = line.substring(firstComma + 1);
                    const parts = rest.split(',');
                    danbooruTagsMap.set(tag, {
                        category: parts[0] || '0',
                        count: parseInt(parts[1]) || 0,
                        aliases: parts.slice(2).join(',').replace(/"/g, '').trim()
                    });
                }
            }
            console.log(`[Megumin Suite] Loaded ${danbooruTagsMap.size} Danbooru tags.`);
            return danbooruTagsMap;
        } catch (e) {
            console.error('[Megumin Suite] Failed to load tags.csv:', e);
            return new Map();
        }
    }

    const BANNED_PROMPT_WORDS = ['loli', 'teenage', 'teenager', 'child', 'underage', 'minor'];

    function sanitizePromptTags(promptText) {
        if (!promptText) return "";
        const tags = promptText.split(',').map(t => t.trim()).filter(t => t);
        const cleaned = tags.filter(tag => {
            const lower = tag.toLowerCase().replace(/\s+/g, '_');
            if (BANNED_PROMPT_WORDS.some(bw => lower.includes(bw))) return false;
            return true;
        });
        return cleaned.join(', ');
    }

    function escapeLiteralComfyParentheses(text) {
        return String(text ?? "").replace(/[()]/g, (match, offset, source) => {
            return offset > 0 && source[offset - 1] === '\\' ? match : `\\${match}`;
        });
    }

    function normalizeAnimaGeneratedTag(rawTag) {
        let tag = String(rawTag ?? "").trim().toLowerCase();
        if (!tag) return "";

        const weightedMatch = tag.match(/^\((.*):([0-9]+(?:\.[0-9]+)?)\)$/);
        if (weightedMatch) {
            const inner = weightedMatch[1].trim().replace(/_/g, ' ');
            return `(${escapeLiteralComfyParentheses(inner)}:${weightedMatch[2]})`;
        }

        if (/^score_[1-9]$/.test(tag)) return tag;

        tag = tag.replace(/_/g, ' ');
        return escapeLiteralComfyParentheses(tag);
    }

    function normalizeAnimaGeneratedTags(tagString) {
        if (!tagString || typeof tagString !== 'string') return tagString || "";
        const tags = tagString.split(',').map(normalizeAnimaGeneratedTag).filter(t => t);
        return tags.join(', ');
    }

    function getAnimaMaxTags(s) {
        const raw = parseInt(s?.animaMaxTags);
        if (!Number.isFinite(raw) || raw <= 0) return 0;
        return Math.min(Math.max(raw, 5), 300);
    }

    function limitAnimaPromptTags(tagString, s, li) {
        const maxTags = getAnimaMaxTags(s);
        if (!maxTags || !tagString || typeof tagString !== 'string') return tagString || "";
        if (isNaturalLanguageImageStyle(s?.promptStyle) || isBooruStandardImageMode(s, li)) return tagString;

        const seen = new Set();
        const tags = tagString
            .split(',')
            .map(t => t.trim())
            .filter(t => t)
            .filter(tag => {
                const key = tag.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

        if (tags.length <= maxTags) return tags.join(', ');
        return tags.slice(0, maxTags).join(', ');
    }

    function normalizeGeneratedTagField(tagString) {
        return normalizeAnimaGeneratedTags(sanitizePromptTags(tagString || ""));
    }

    function parseMatchKeywords(matchKeywords) {
        if (!matchKeywords || typeof matchKeywords !== 'string') return [];
        const seen = new Set();
        return matchKeywords
            .split(',')
            .map(k => k.trim().toLowerCase())
            .filter(k => k)
            .map(k => k.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim())
            .filter(k => {
                if (!k || seen.has(k)) return false;
                seen.add(k);
                return true;
            });
    }

    function normalizeTextForKeywordMatching(text) {
        return String(text || "")
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function keywordAppearsInText(keyword, normalizedText) {
        const kw = parseMatchKeywords(keyword).join(' ');
        if (!kw || !normalizedText) return false;
        const tokens = kw.split(' ').map(escapeRegex).filter(Boolean);
        if (tokens.length === 0) return false;
        const phrase = tokens.join('[\\s_\\-]+');
        return new RegExp(`(^|[^\\p{L}\\p{N}])${phrase}(?=$|[^\\p{L}\\p{N}])`, 'u').test(normalizedText);
    }

    function assignmentMatchesRecentChat(a, recentChat, allowEmptyMatch = true) {
        if (a?.neverInclude) return false;
        if (a?.alwaysInclude) return true;
        const kws = parseMatchKeywords(a?.match_keywords);
        if (kws.length === 0) return allowEmptyMatch;
        const normalizedText = normalizeTextForKeywordMatching(recentChat);
        return kws.some(kw => keywordAppearsInText(kw, normalizedText));
    }

    function ensureStructuredCharacterAssignment(a) {
        if (!a || typeof a !== 'object') return a;
        if (a.character_tag === undefined) a.character_tag = "";
        if (a.series_tag === undefined) a.series_tag = "";
        if (a.physical_tags === undefined) a.physical_tags = a.booru_tags || "";
        if (a.clothing_tags === undefined) a.clothing_tags = "";
        if (a.plain_description === undefined) a.plain_description = "";
        if (a.alwaysInclude === undefined) a.alwaysInclude = false;
        if (a.neverInclude === undefined) a.neverInclude = false;
        if (a.neverInclude) a.alwaysInclude = false;
        if (!a.tagFieldToggles) a.tagFieldToggles = {};
        getTagFieldToggleDefaults().forEach(({ key }) => {
            if (a.tagFieldToggles[key] === undefined) a.tagFieldToggles[key] = true;
        });
        return a;
    }

    function getTagFieldToggleDefaults() {
        return [
            { key: "characterTag", label: "Char" },
            { key: "seriesTag", label: "Series" },
            { key: "physicalTags", label: "Phys" },
            { key: "clothingTags", label: "Clothes" }
        ];
    }

    function ensureLoraIntelDefaults(li) {
        if (!li) return;
        if (!Array.isArray(li.globalActiveLoras)) li.globalActiveLoras = [];
        if (!li.characterActiveLoras || typeof li.characterActiveLoras !== "object") li.characterActiveLoras = {};
        if (!li.characterAssignments || typeof li.characterAssignments !== "object") li.characterAssignments = {};
        if (!li.characterAssignmentsByMode || typeof li.characterAssignmentsByMode !== "object") li.characterAssignmentsByMode = {};
        ["lora", "booru", "mixed", "description", "shared"].forEach(mode => {
            if (!li.characterAssignmentsByMode[mode] || typeof li.characterAssignmentsByMode[mode] !== "object") {
                li.characterAssignmentsByMode[mode] = {};
            }
        });
        if (li.ensureCharacterTag === undefined) li.ensureCharacterTag = false;
        if (li.descriptionStyle === undefined) li.descriptionStyle = 'booru';
        if (li.promptAssemblyMode === undefined) li.promptAssemblyMode = 'structured';
        if (li.assignmentViewMode === undefined) li.assignmentViewMode = 'structured';
        if (li.lastCharacterAnalysisResponse === undefined) li.lastCharacterAnalysisResponse = "";
        if (li.compiledPromptOverride === undefined) li.compiledPromptOverride = "";
        if (!li.tagFieldToggles) li.tagFieldToggles = {};
        const defaults = {};
        getTagFieldToggleDefaults().forEach(({ key }) => { defaults[key] = true; });
        Object.keys(defaults).forEach(key => {
            if (li.tagFieldToggles[key] === undefined) li.tagFieldToggles[key] = defaults[key];
        });
    }

    function normalizeStructuredCharacterAssignment(a) {
        ensureStructuredCharacterAssignment(a);
        if (!a || typeof a !== 'object') return a;

        ['booru_tags', 'character_tag', 'series_tag', 'physical_tags', 'clothing_tags'].forEach(key => {
            if (a[key]) a[key] = normalizeGeneratedTagField(a[key]);
        });

        const mergedTags = [
            a.character_tag,
            a.series_tag,
            a.physical_tags,
            a.clothing_tags
        ].filter(Boolean).join(', ');

        a.booru_tags = mergedTags || normalizeGeneratedTagField(a.booru_tags || "");
        if (!a.plain_description) {
            a.plain_description = mergedTags || a.description || "";
        }
        return a;
    }

    function ensureStructuredCharacterAssignments(li, charKey = null) {
        if (!li) return;
        ensureLoraIntelDefaults(li);
        const normalizeStore = (store) => {
            const keys = charKey ? [charKey] : Object.keys(store || {});
            keys.forEach(key => {
                if (!Array.isArray(store[key])) return;
                store[key].forEach(ensureStructuredCharacterAssignment);
            });
        };
        normalizeStore(li.characterAssignments);
        Object.values(li.characterAssignmentsByMode || {}).forEach(normalizeStore);
    }

    function getCharacterAssignmentModeKey(li) {
        if (!li) return "shared";
        if (li.ensureLoras && li.useDanbooruTags) return "mixed";
        if (li.ensureLoras) return "lora";
        if (li.useDanbooruTags) return "booru";
        if (li.useCharDescriptions) return "description";
        return "shared";
    }

    function getModeCharacterAssignmentStore(li, modeKey = null) {
        ensureLoraIntelDefaults(li);
        const key = modeKey || getCharacterAssignmentModeKey(li);
        if (!li.characterAssignmentsByMode[key]) li.characterAssignmentsByMode[key] = {};
        return li.characterAssignmentsByMode[key];
    }

    function getModeCharacterAssignments(li, charKey, modeKey = null) {
        if (!li) return [];
        ensureLoraIntelDefaults(li);
        const store = getModeCharacterAssignmentStore(li, modeKey);
        if (!Array.isArray(store[charKey])) {
            const anyModeAlreadyHasCharacter = Object.values(li.characterAssignmentsByMode || {})
                .some(modeStore => Array.isArray(modeStore?.[charKey]));
            const legacy = !anyModeAlreadyHasCharacter && Array.isArray(li.characterAssignments?.[charKey])
                ? JSON.parse(JSON.stringify(li.characterAssignments[charKey]))
                : [];
            store[charKey] = legacy;
        }
        store[charKey].forEach(ensureStructuredCharacterAssignment);
        if (!li.characterAssignments || typeof li.characterAssignments !== "object") li.characterAssignments = {};
        li.characterAssignments[charKey] = store[charKey];
        return store[charKey];
    }

    function setModeCharacterAssignments(li, charKey, assignments, modeKey = null) {
        ensureLoraIntelDefaults(li);
        const store = getModeCharacterAssignmentStore(li, modeKey);
        store[charKey] = Array.isArray(assignments) ? assignments.map(ensureStructuredCharacterAssignment) : [];
        if (!li.characterAssignments || typeof li.characterAssignments !== "object") li.characterAssignments = {};
        li.characterAssignments[charKey] = store[charKey];
        return store[charKey];
    }

    function countModeCharacterAssignments(li, charKey, modeKey = null) {
        return getModeCharacterAssignments(li, charKey, modeKey).length;
    }

    function getAssignmentModeLabel(li) {
        const key = getCharacterAssignmentModeKey(li);
        if (key === "lora") return "LoRA";
        if (key === "booru") return "Booru Tags";
        if (key === "mixed") return "LoRA + Booru";
        if (key === "description") return "Description";
        return "Shared";
    }

    function syncCurrentModeCharacterAssignments(li, charKey) {
        getModeCharacterAssignments(li, charKey);
        ensureStructuredCharacterAssignments(li, charKey);
    }

    function buildCharacterAnalysisSnapshot(li, charKey, scope = "global") {
        ensureLoraIntelDefaults(li);
        ensureStructuredCharacterAssignments(li, charKey);
        const activeLoras = scope === "character" && li.characterActiveLoras[charKey]
            ? li.characterActiveLoras[charKey]
            : li.globalActiveLoras;
        const mode = li.ensureLoras && li.useDanbooruTags ? "mixed" : (li.ensureLoras ? "lora" : "booru");
        return {
            schema: "megumin-character-analysis",
            version: 1,
            exportedAt: new Date().toISOString(),
            sourceCharacterKey: charKey,
            mode,
            settings: {
                ensureLoras: !!li.ensureLoras,
                useDanbooruTags: !!li.useDanbooruTags,
                ensureCharacterTag: !!li.ensureCharacterTag,
                useCharDescriptions: !!li.useCharDescriptions,
                descriptionStyle: li.descriptionStyle,
                promptAssemblyMode: li.promptAssemblyMode,
                assignmentViewMode: li.assignmentViewMode,
                tagFieldToggles: JSON.parse(JSON.stringify(li.tagFieldToggles || {}))
            },
            loraScope: scope === "character" ? "character" : "global",
            activeLoras: JSON.parse(JSON.stringify(activeLoras || [])),
            assignmentMode: getCharacterAssignmentModeKey(li),
            assignments: JSON.parse(JSON.stringify(getModeCharacterAssignments(li, charKey))),
            lastCharacterAnalysisResponse: li.lastCharacterAnalysisResponse || ""
        };
    }

    function applyCharacterAnalysisSnapshot(li, charKey, payload) {
        if (!payload || payload.schema !== "megumin-character-analysis" || payload.version !== 1) {
            throw new Error("This is not a supported Megumin character-analysis snapshot.");
        }
        if (!Array.isArray(payload.assignments)) throw new Error("Snapshot assignments are missing or invalid.");
        ensureLoraIntelDefaults(li);

        const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
        ["ensureLoras", "useDanbooruTags", "ensureCharacterTag", "useCharDescriptions"].forEach(key => {
            if (typeof settings[key] === "boolean") li[key] = settings[key];
        });
        ["descriptionStyle", "promptAssemblyMode", "assignmentViewMode"].forEach(key => {
            if (typeof settings[key] === "string" && settings[key]) li[key] = settings[key];
        });
        if (settings.tagFieldToggles && typeof settings.tagFieldToggles === "object") {
            li.tagFieldToggles = { ...li.tagFieldToggles, ...settings.tagFieldToggles };
        }

        const assignments = JSON.parse(JSON.stringify(payload.assignments));
        assignments.forEach(ensureStructuredCharacterAssignment);
        setModeCharacterAssignments(li, charKey, assignments);

        if (Array.isArray(payload.activeLoras)) {
            const activeLoras = payload.activeLoras
                .filter(lora => lora && typeof lora.name === "string" && lora.name.trim())
                .map(lora => ({
                    ...lora,
                    name: lora.name.trim(),
                    enabled: lora.enabled !== false,
                    keywords: Array.isArray(lora.keywords) ? lora.keywords.map(String).filter(Boolean) : []
                }));
            if (payload.loraScope === "character") li.characterActiveLoras[charKey] = activeLoras;
            else li.globalActiveLoras = activeLoras;
        }
        li.lastCharacterAnalysisResponse = typeof payload.lastCharacterAnalysisResponse === "string"
            ? payload.lastCharacterAnalysisResponse
            : "";
        return { count: assignments.length, mode: payload.mode || "snapshot" };
    }

    function downloadCharacterAnalysisSnapshot(li, charKey, scope) {
        const snapshot = buildCharacterAnalysisSnapshot(li, charKey, scope);
        const safeKey = String(charKey || "character").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "character";
        const link = document.createElement("a");
        const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
        link.href = url;
        link.download = `megumin-character-analysis-${safeKey}-${snapshot.mode}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function psEscapeAttr(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function psEscapeText(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    const RUNPOD_IMAGE_DEFAULTS = {
        enabled: false,
        endpointId: "",
        apiKey: "",
        pollIntervalMs: 1000,
        timeoutMs: 600000
    };
    const RUNPOD_IMAGE_MODELS = ["ri-mix-illustrious-anima.safetensors", "anima-base-v1.0.safetensors"];
    const RUNPOD_IMAGE_SAMPLERS = ["er_sde", "euler"];
    const RUNPOD_IMAGE_SCHEDULERS = ["simple", "normal", "karras", "exponential", "sgm_uniform", "ddim_uniform", "beta", "linear_quadratic"];
    const RUNPOD_IMAGE_LORAS = ["anima_turbo.safetensors"];
    const RUNPOD_IMAGE_MODEL_ALIASES = {
        "rimixillustriousanima_rimixanima.safetensors": "ri-mix-illustrious-anima.safetensors"
    };

    function normalizeRunpodModelFilename(modelName) {
        const current = String(modelName || "").trim();
        if (!current) return "";
        const basename = current.replace(/\\/g, "/").split("/").pop().toLowerCase();
        return RUNPOD_IMAGE_MODEL_ALIASES[basename] || current;
    }

    function getRunpodGlobalSettings() {
        if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
        if (!extension_settings[extensionName].runpod || typeof extension_settings[extensionName].runpod !== "object") {
            extension_settings[extensionName].runpod = { endpointId: "", apiKey: "" };
        }
        const runpod = extension_settings[extensionName].runpod;
        if (runpod.endpointId === undefined) runpod.endpointId = "";
        if (runpod.apiKey === undefined) runpod.apiKey = "";
        runpod.endpointId = String(runpod.endpointId || "").trim();
        runpod.apiKey = String(runpod.apiKey || "").trim();
        return runpod;
    }

    function ensureRunpodSettings(s) {
        if (!s) return RUNPOD_IMAGE_DEFAULTS;
        if (!s.runpod || typeof s.runpod !== "object") s.runpod = {};
        const globalRunpod = getRunpodGlobalSettings();
        if (!globalRunpod.endpointId && s.runpod.endpointId) globalRunpod.endpointId = String(s.runpod.endpointId || "").trim();
        if (!globalRunpod.apiKey && s.runpod.apiKey) globalRunpod.apiKey = String(s.runpod.apiKey || "").trim();
        Object.keys(RUNPOD_IMAGE_DEFAULTS).forEach(key => {
            if (s.runpod[key] === undefined) s.runpod[key] = RUNPOD_IMAGE_DEFAULTS[key];
        });
        s.runpod.enabled = !!s.runpod.enabled;
        s.runpod.endpointId = globalRunpod.endpointId;
        s.runpod.apiKey = globalRunpod.apiKey;
        s.runpod.pollIntervalMs = Math.max(500, parseInt(s.runpod.pollIntervalMs, 10) || RUNPOD_IMAGE_DEFAULTS.pollIntervalMs);
        s.runpod.timeoutMs = Math.max(30000, parseInt(s.runpod.timeoutMs, 10) || RUNPOD_IMAGE_DEFAULTS.timeoutMs);
        return s.runpod;
    }

    function isRunpodReady(s) {
        const runpod = ensureRunpodSettings(s);
        return !!(runpod.enabled && runpod.endpointId && runpod.apiKey);
    }

    function ensureSelectHasOptions($select, options, currentValue, emptyLabel = null) {
        $select.empty();
        if (emptyLabel !== null) $select.append($("<option></option>").attr("value", "").text(emptyLabel));
        const seen = new Set();
        options.forEach(option => {
            const value = String(option || "").trim();
            if (!value || seen.has(value)) return;
            seen.add(value);
            $select.append($("<option></option>").attr("value", value).text(value));
        });
        const current = String(currentValue || "").trim();
        if (current && !seen.has(current)) {
            $select.append($("<option></option>").attr("value", current).text(`${current} (saved)`));
        }
        $select.val(current || "");
    }

    function ensureRunpodDropdownValues(s) {
        if (!s) return false;
        let changed = false;
        const normalizedModel = normalizeRunpodModelFilename(s.selectedModel);
        if (normalizedModel !== s.selectedModel) {
            s.selectedModel = normalizedModel;
            changed = true;
        }
        if (!s.selectedModel && RUNPOD_IMAGE_MODELS[0]) {
            s.selectedModel = RUNPOD_IMAGE_MODELS[0];
            changed = true;
        }
        if (!s.selectedSampler && RUNPOD_IMAGE_SAMPLERS[0]) {
            s.selectedSampler = RUNPOD_IMAGE_SAMPLERS[0];
            changed = true;
        }
        if (!s.selectedScheduler && RUNPOD_IMAGE_SCHEDULERS[0]) {
            s.selectedScheduler = RUNPOD_IMAGE_SCHEDULERS[0];
            changed = true;
        }
        return changed;
    }

    function populateRunpodImageLists(s) {
        ensureRunpodDropdownValues(s);
        ensureSelectHasOptions($("#ig_model"), RUNPOD_IMAGE_MODELS, s.selectedModel, "-- Select Model --");
        ensureSelectHasOptions($("#ig_sampler"), RUNPOD_IMAGE_SAMPLERS, s.selectedSampler);
        ensureSelectHasOptions($("#ig_scheduler"), RUNPOD_IMAGE_SCHEDULERS, s.selectedScheduler);
        for (let i = 1; i <= 4; i++) {
            const key = i === 1 ? "selectedLora" : `selectedLora${i}`;
            ensureSelectHasOptions($(`#ig_lora_${i}`), RUNPOD_IMAGE_LORAS, s[key], "-- No LoRA --");
        }
    }

    let danbooruAliasMap = null;

    function ensureDanbooruAliasMap() {
        if (danbooruAliasMap) return danbooruAliasMap;
        if (!danbooruTagsMap || danbooruTagsMap.size === 0) return null;
        danbooruAliasMap = new Map();
        for (const [canonical, data] of danbooruTagsMap) {
            if (data.aliases) {
                const aliasList = data.aliases.split(',').map(a => a.trim().toLowerCase().replace(/\s+/g, '_')).filter(a => a);
                for (const alias of aliasList) {
                    danbooruAliasMap.set(alias, canonical);
                }
            }
        }
        return danbooruAliasMap;
    }

    function repairBooruTags(tagString) {
        if (!tagString || typeof tagString !== 'string') return tagString || "";
        if (!danbooruTagsMap || danbooruTagsMap.size === 0) return tagString;

        const aliasMap = ensureDanbooruAliasMap();

        const tags = tagString.split(',').map(t => t.trim()).filter(t => t);
        const repaired = tags.map(rawTag => {
            const normalized = rawTag.toLowerCase().replace(/\s+/g, '_');
            if (danbooruTagsMap.has(normalized)) return normalized;
            if (aliasMap && aliasMap.has(normalized)) return aliasMap.get(normalized);
            return normalized;
        });

        return repaired.join(', ');
    }

    // -------------------------------------------------------------
    // CIVITAI KEYWORD FETCHER
    // -------------------------------------------------------------
    const LORA_TRIGGER_ONLY_IDENTITIES = new Set([
        "sandy cheeks",
        "kate middleton"
    ]);

    const LORA_AMBIGUOUS_IDENTITY_GENDERS = new Map([
        ["alex jones", "man"]
    ]);

    function getVrtlLoraIdentityKeywords(loraFilename) {
        const basename = String(loraFilename || "")
            .replace(/\\/g, "/")
            .split("/")
            .pop()
            .replace(/\.(safetensors|ckpt|pt|bin)$/i, "")
            .replace(/\(\d+\)\s*$/i, "")
            .trim();
        const triggers = [...basename.matchAll(/\bvrtl[\w-]+\b/gi)].map(m => m[0]);
        if (triggers.length === 0) return null;

        const uniqueTriggers = [...new Map(triggers.map(t => [t.toLowerCase(), t])).values()];
        const mainTrigger = uniqueTriggers.find(t => /^vrtlmain$/i.test(t));
        if (mainTrigger) return [mainTrigger];
        if (uniqueTriggers.length > 1) return uniqueTriggers;

        const triggerGroupIndex = basename.search(/\([^)]*\bvrtl/i);
        const identityName = (triggerGroupIndex >= 0 ? basename.slice(0, triggerGroupIndex) : "")
            .replace(/^ZI\s+/i, "")
            .trim();
        const trigger = uniqueTriggers[0];
        if (!identityName || LORA_TRIGGER_ONLY_IDENTITIES.has(identityName.toLowerCase())) return [trigger];

        const gender = LORA_AMBIGUOUS_IDENTITY_GENDERS.get(identityName.toLowerCase());
        return [`${identityName} (${trigger})${gender ? `, ${gender}` : ""}`];
    }

    function getEffectiveLoraKeywords(lora) {
        const identityKeywords = getVrtlLoraIdentityKeywords(lora?.name);
        if (identityKeywords) return identityKeywords;
        return Array.isArray(lora?.keywords) ? lora.keywords.filter(Boolean) : [];
    }

    function getDefaultLoraKeywords(loraName) {
        const identityKeywords = getVrtlLoraIdentityKeywords(loraName);
        if (identityKeywords) return identityKeywords;
        const cleanName = String(loraName || "").replace(/\.(safetensors|ckpt|pt|bin)$/i, '').replace(/\\|\/|\s/g, ' ').trim();
        return civitaiKeywordCache[cleanName] || ["a woman"];
    }

    async function fetchCivitaiKeywords(loraFilename) {
        const identityKeywords = getVrtlLoraIdentityKeywords(loraFilename);
        if (identityKeywords) return identityKeywords;
        const cleanName = loraFilename.replace(/\.(safetensors|ckpt|pt|bin)$/i, '').replace(/\\|\/|\s/g, ' ').trim();
        if (civitaiKeywordCache[cleanName]) return civitaiKeywordCache[cleanName];
        try {
            const searchUrl = `https://civitai.com/api/v1/models?types=LORA&query=${encodeURIComponent(cleanName)}&limit=5`;
            const res = await fetch(searchUrl);
            if (!res.ok) return null;
            const data = await res.json();
            if (!data.items || data.items.length === 0) return null;

            const bestMatch = data.items[0];
            const version = bestMatch.modelVersions && bestMatch.modelVersions[0];
            if (!version) return null;

            const keywords = version.trainedWords || [];
            if (keywords.length === 0) return null;

            civitaiKeywordCache[cleanName] = keywords;
            return keywords;
        } catch (e) {
            console.warn(`[Megumin Suite] Civitai keyword fetch failed for ${loraFilename}:`, e);
            return null;
        }
    }


    function ensureImageGenLoraArrays(s) {
        if (!s) return;
        if (!Array.isArray(s.loraSlotLocked) || s.loraSlotLocked.length !== 4) {
            s.loraSlotLocked = [false, false, false, false];
        }
        if (!Array.isArray(s.loraSlotKeywordManaged) || s.loraSlotKeywordManaged.length !== 4) {
            s.loraSlotKeywordManaged = [false, false, false, false];
        }
    }

    function setupImageGenCollapsibleSections(s) {
        const states = s.sectionOpenStates;
        $("[data-ig-collapse]").each(function() {
            const $panel = $(this);
            const key = String($panel.attr("data-ig-collapse") || "").trim();
            if (!key || $panel.data("ig-collapse-ready")) return;

            let $header = $panel.children("[data-ig-collapse-header]").first();
            if (!$header.length) $header = $panel.children(".ps-rule-title").first();
            if (!$header.length) return;

            const $bodyChildren = $panel.children().not($header);
            if (!$bodyChildren.length) return;
            $bodyChildren.wrapAll(`<div class="ig-collapsible-section-body" data-ig-collapse-body="${psEscapeAttr(key)}"></div>`);
            const $body = $panel.children(`[data-ig-collapse-body="${key}"]`);
            const isOpen = states[key] === true;

            $panel.data("ig-collapse-ready", true);
            $header.css({
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                cursor: "pointer",
                userSelect: "none",
                marginBottom: "0"
            });
            $header.append(`<i class="fa-solid fa-chevron-down ig-section-chevron" aria-hidden="true" style="margin-left:auto; color:var(--text-muted); font-size:.72rem; transition:transform .2s; transform:${isOpen ? "rotate(180deg)" : "none"};"></i>`);
            $body.css({ marginTop: "12px", display: isOpen ? "block" : "none" });

            $header.on("click.igCollapse", function(event) {
                if ($(event.target).closest("button,input,select,textarea,a,.ps-toggle-card").length) return;
                const nextOpen = !$body.is(":visible");
                states[key] = nextOpen;
                saveProfileToMemory();
                $header.find(".ig-section-chevron").css("transform", nextOpen ? "rotate(180deg)" : "none");
                $body.stop(true, true)[nextOpen ? "slideDown" : "slideUp"](180);
            });
        });
    }

    function renderImageGen(c) {
        c.empty();
        const s = getLocalProfile().imageGen;
        ensureImageGenLoraArrays(s);
        const runpod = ensureRunpodSettings(s);
        if (s.standardBooruLeadTags === undefined) s.standardBooruLeadTags = "";
        if (s.structuredPromptRules === undefined) s.structuredPromptRules = true;
        if (s.adultTagPrecision === undefined) s.adultTagPrecision = true;
        if (s.includePromptExamples === undefined) s.includePromptExamples = false;
        if (s.selectedScheduler === undefined) s.selectedScheduler = "simple";
        if (s.manualSceneSelector === undefined) s.manualSceneSelector = false;
        if (s.manualPromptSource === undefined) s.manualPromptSource = "comfy_llm";
        if (!s.sectionOpenStates || typeof s.sectionOpenStates !== "object" || Array.isArray(s.sectionOpenStates)) s.sectionOpenStates = {};
        const automation = ensureBackgroundAutomationSettings(s);

        // LoRA Intelligence state
        if (!s.loraIntel) s.loraIntel = { enabled: false, ensureLoras: false, useDanbooruTags: true, ensureCharacterTag: false, useCharDescriptions: false, descriptionStyle: 'booru', promptAssemblyMode: 'structured', globalActiveLoras: [], characterActiveLoras: {}, characterAssignments: {}, characterAssignmentsByMode: {}, lastCharacterAnalysisResponse: "", compiledPromptOverride: "" };
        if (s.animaMaxTags === undefined) s.animaMaxTags = 60;
        if (s.manualPrompt === undefined) s.manualPrompt = "";
        ensureLoraIntelDefaults(s.loraIntel);
        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        ensureStructuredCharacterAssignments(li, charKey);
        const liScope = li.characterActiveLoras[charKey] ? 'character' : 'global';
        syncCurrentModeCharacterAssignments(li, charKey);
        const liAssignments = getModeCharacterAssignments(li, charKey);

        c.append(`
            <!-- MASTER TOGGLE -->
            <div class="ps-toggle-card ${s.enabled ? 'active' : ''}" id="ig_enable_card" style="border-color: ${s.enabled ? 'var(--gold)' : 'var(--border-color)'};">
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:700; font-size: 1.1rem; color: ${s.enabled ? 'var(--gold)' : 'var(--text-main)'};"><i class="fa-solid fa-image"></i> Enable Image Generation</span>
                    <div style="margin-top:4px; font-size: 0.8rem; color: var(--text-muted);">Activate ComfyUI integration for this specific character/group.</div>
                </div>
                <div class="ps-switch"></div>
            </div>
            <!-- Utility / legacy prompt backend -->
                <div data-ig-collapse="utility-backend" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-gears"></i> SillyTavern Utility LLM Backend</div>
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <div style="flex: 1;">
                            <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-main);">Character analysis and legacy prompt calls</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted);">Used by character analysis and when the yellow quick-image source below is set to SillyTavern. It does not control ComfyUI NanoGPT mode.</div>
                        </div>
                        <select id="img_gen_backend" class="ps-modern-input" style="width: 220px; cursor: pointer;">
                            <option value="direct" ${s.generatorBackend === 'direct' ? 'selected' : ''}>Current ST Connection</option>
                            <option value="preset" ${s.generatorBackend === 'preset' ? 'selected' : ''}>Megumin Image Preset</option>
                        </select>
                    </div>
                </div>

            <div id="ig_main_content" style="display: ${s.enabled ? 'block' : 'none'};">

                <!-- Connection & Workflow -->
                <div data-ig-collapse="comfy-workflow" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-link"></i> ComfyUI Server & Workflow</div>

                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <input type="text" id="ig_url" class="ps-modern-input" value="${s.comfyUrl}" placeholder="http://127.0.0.1:8188" style="flex: 1;" />
                        <button id="ig_test_btn" class="ps-modern-btn secondary" style="padding: 0 15px;"><i class="fa-solid fa-wifi"></i> Test</button>
                    </div>

                    <div style="display: flex; gap: 10px; align-items: center;">
                        <select id="ig_workflow_list" class="ps-modern-input" style="flex: 1; cursor: pointer;"></select>
                        <button id="ig_new_wf" class="ps-modern-btn secondary" title="New Workflow"><i class="fa-solid fa-plus"></i></button>
                        <button id="ig_edit_wf" class="ps-modern-btn secondary" title="Edit JSON"><i class="fa-solid fa-pen"></i></button>
                        <button id="ig_del_wf" class="ps-modern-btn secondary" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3);" title="Delete"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>

                <div data-ig-collapse="runpod" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-cloud"></i> RunPod Serverless</div>
                    <div class="ps-toggle-card ${runpod.enabled ? 'active' : ''}" id="ig_runpod_card" style="padding: 12px 18px; margin-bottom: 15px;">
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; font-size:0.85rem;">Render with RunPod</span>
                            <div style="margin-top:2px; font-size: 0.7rem; color: var(--text-muted);">Sends the same prepared workflow to your RunPod endpoint instead of local ComfyUI. Endpoint and API key are saved in local extension settings.</div>
                        </div>
                        <div class="ps-switch"></div>
                    </div>
                    <div id="ig_runpod_settings" style="display: ${runpod.enabled ? 'block' : 'none'};">
                        <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr); gap: 12px; margin-bottom: 12px;">
                            <div>
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Endpoint ID</div>
                                <input type="text" id="ig_runpod_endpoint" class="ps-modern-input" value="${psEscapeAttr(runpod.endpointId)}" placeholder="your-endpoint-id" style="padding: 8px; font-size: 0.8rem;" />
                            </div>
                            <div>
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">API Key</div>
                                <input type="password" id="ig_runpod_key" class="ps-modern-input" value="${psEscapeAttr(runpod.apiKey)}" placeholder="RunPod API key" autocomplete="off" style="padding: 8px; font-size: 0.8rem;" />
                            </div>
                        </div>
                        <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px;">
                            <div>
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Poll Interval (ms)</div>
                                <input type="number" id="ig_runpod_poll" class="ps-modern-input" value="${psEscapeAttr(runpod.pollIntervalMs)}" min="500" step="250" style="padding: 8px; font-size: 0.8rem;" />
                            </div>
                            <div>
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Timeout (ms)</div>
                                <input type="number" id="ig_runpod_timeout" class="ps-modern-input" value="${psEscapeAttr(runpod.timeoutMs)}" min="30000" step="10000" style="padding: 8px; font-size: 0.8rem;" />
                            </div>
                        </div>
                    </div>
                </div>

                <div data-ig-collapse="generation-formatting" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-pen-nib"></i> Generation Triggers & Formatting</div>

                    <div style="display: flex; gap: 15px; margin-bottom: 15px;">
                        <div style="flex: 2;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Trigger Mode</div>
                            <select id="ig_trigger_mode" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem; cursor: pointer;">
                                <option value="always" ${s.triggerMode === 'always' ? 'selected' : ''}>Always (Every Reply)</option>
                                <option value="frequency" ${s.triggerMode === 'frequency' ? 'selected' : ''}>After X Replies</option>
                                <option value="conditional" ${s.triggerMode === 'conditional' ? 'selected' : ''}>Only when character sends a pic</option>
                                <option value="manual" ${s.triggerMode === 'manual' ? 'selected' : ''}>Manual Button Only</option>
                            </select>
                        </div>
                        <div style="flex: 1; display: ${s.triggerMode === 'frequency' ? 'block' : 'none'};" id="ig_freq_container">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Every X Replies</div>
                            <input type="number" id="ig_auto_freq" class="ps-modern-input" value="${s.autoGenFreq}" min="1" style="padding: 8px; font-size: 0.8rem; text-align: center;" />
                        </div>
                    </div>

                    <div class="ps-toggle-card ${s.previewPrompt ? 'active' : ''}" id="ig_preview_card" style="padding: 12px 18px; margin-bottom: 15px;">
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; font-size:0.85rem;">Preview Prompt Before Sending</span>
                            <div style="margin-top:2px; font-size: 0.7rem; color: var(--text-muted);">Show a popup to view or edit the AI's prompt before rendering.</div>
                        </div>
                        <div class="ps-switch"></div>
                    </div>

                    <div class="ps-toggle-card ${s.manualSceneSelector ? 'active' : ''}" id="ig_manual_scene_selector_card" style="padding: 12px 18px; margin-bottom: 15px;">
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; font-size:0.85rem;">Manual Scene Character Selector</span>
                            <div style="margin-top:2px; font-size: 0.7rem; color: var(--text-muted);">When clicking the quick Generate Prompt button, choose which analyzed characters are in this scene. Bypasses match keywords for this generation.</div>
                        </div>
                        <div class="ps-switch"></div>
                    </div>
                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:15px; padding:12px 14px; border:1px solid var(--border-color); border-radius:9px; background:rgba(0,0,0,.16);">
                        <div style="flex:1; min-width:180px;">
                            <div style="font-size:.8rem; font-weight:700;">Yellow Quick-Image Button</div>
                            <div style="font-size:.66rem; color:var(--text-muted); margin-top:2px;">This directly controls what happens when you click the yellow image button beside Send. ComfyUI NanoGPT uses %ai_text% without calling SillyTavern's LLM.</div>
                        </div>
                        <select id="ig_manual_prompt_source" class="ps-modern-input" style="width:245px; padding:8px; font-size:.75rem;">
                            <option value="comfy_llm" ${s.manualPromptSource === 'comfy_llm' ? 'selected' : ''}>ComfyUI NanoGPT (Fast)</option>
                            <option value="deterministic" ${s.manualPromptSource === 'deterministic' ? 'selected' : ''}>Deterministic Tags</option>
                            <option value="sillytavern" ${s.manualPromptSource === 'sillytavern' ? 'selected' : ''}>SillyTavern / Megumin Image</option>
                        </select>
                    </div>

                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin-bottom: 15px;">
                        <div class="ps-toggle-card ${s.structuredPromptRules ? 'active' : ''}" id="ig_structured_rules_card" style="padding: 12px 14px;">
                            <div style="display:flex; flex-direction:column;">
                                <span style="font-weight:600; font-size:0.8rem;">Structured Prompt Rules</span>
                                <div style="margin-top:2px; font-size: 0.65rem; color: var(--text-muted);">Adds beta-style ordering and anti-feature-bleed rules.</div>
                            </div>
                            <div class="ps-switch"></div>
                        </div>
                        <div class="ps-toggle-card ${s.adultTagPrecision ? 'active' : ''}" id="ig_adult_precision_card" style="padding: 12px 14px;">
                            <div style="display:flex; flex-direction:column;">
                                <span style="font-weight:600; font-size:0.8rem;">Adult Tag Precision</span>
                                <div style="margin-top:2px; font-size: 0.65rem; color: var(--text-muted);">Uses direct visual terms for explicit adult scenes.</div>
                            </div>
                            <div class="ps-switch"></div>
                        </div>
                        <div class="ps-toggle-card ${s.includePromptExamples ? 'active' : ''}" id="ig_prompt_examples_card" style="padding: 12px 14px;">
                            <div style="display:flex; flex-direction:column;">
                                <span style="font-weight:600; font-size:0.8rem;">Template Examples</span>
                                <div style="margin-top:2px; font-size: 0.65rem; color: var(--text-muted);">Adds examples for steadier composition at higher token cost.</div>
                            </div>
                            <div class="ps-switch"></div>
                        </div>
                    </div>

                    <div id="ig_prompt_builder" style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; border-left: 3px solid var(--gold);">
                        <div style="display: flex; gap: 15px; margin-bottom: 10px;">
                            <div style="flex: 1;">
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Model Style Format</div>
                                <select id="ig_style" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;">
                                    <option value="standard" ${s.promptStyle === 'standard' ? 'selected' : ''}>Standard (Descriptive)</option>
                                    <option value="illustrious" ${s.promptStyle === 'illustrious' ? 'selected' : ''}>Illustrious/Pony (Tags)</option>
                                    <option value="sdxl" ${s.promptStyle === 'sdxl' ? 'selected' : ''}>SDXL (Natural Prose)</option>
                                    <option value="zimage" ${s.promptStyle === 'zimage' ? 'selected' : ''}>Z-Image LoRA (Natural Language)</option>
                                </select>
                            </div>
                            <div style="flex: 1;">
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Camera Perspective</div>
                                <select id="ig_persp" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;">
                                    <option value="scene" ${s.promptPerspective === 'scene' ? 'selected' : ''}>Cinematic Scene</option>
                                    <option value="pov" ${s.promptPerspective === 'pov' ? 'selected' : ''}>First Person (POV)</option>
                                    <option value="character" ${s.promptPerspective === 'character' ? 'selected' : ''}>Character Portrait</option>
                                </select>
                            </div>
                            <div style="width: 145px;">
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Anima Tag Cap</div>
                                <input type="number" id="ig_anima_max_tags" class="ps-modern-input" value="${getAnimaMaxTags(s) || 0}" min="0" max="300" step="5" title="Maximum comma-separated tags for Anima-style prompts. Set 0 to disable." style="padding: 8px; font-size: 0.8rem; text-align: center;" />
                            </div>
                        </div>
                        <div style="margin-bottom: 8px;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Leading tags (comma-separated)</div>
                            <div style="font-size: 0.65rem; color: var(--text-muted); margin-bottom: 4px;">Prepended to the Comfy positive prompt when LoRA Intelligence is on, Booru Tags mode is enabled, and this field is non-empty. Does not depend on Model Style. Extra below is separate (image-prompt instructions). Leave empty to skip.</div>
                            <input type="text" id="ig_std_booru_lead" class="ps-modern-input" placeholder="e.g. nsfw, uncensored, @artist, digital anime illustration, 2d anime" value="${(s.standardBooruLeadTags || '').replace(/"/g, '&quot;')}" style="padding: 8px; font-size: 0.8rem;" />
                        </div>
                        <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Extra (tags / cues, comma-separated)</div>
                        <input type="text" id="ig_extra" class="ps-modern-input" placeholder="Extra cues for the image-prompt step (mood, lighting, …)" value="${s.promptExtra}" style="padding: 8px; font-size: 0.8rem;" />
                    </div>
                </div>

                <div id="ig_bg_modes_panel" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 20px; overflow:hidden;">
                    <div id="ig_bg_modes_header" style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:14px 15px; cursor:pointer; user-select:none;">
                        <div class="ps-rule-title" style="margin-bottom:0;"><i class="fa-solid fa-layer-group"></i> Background Visual Modes</div>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span id="ig_bg_qwen_status_compact" title="Latest Smart Qwen activity" style="font-size:0.66rem; color:#a855f7; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Qwen: ${psEscapeText(automation.qwenStatus || "Idle")}</span>
                            <span id="ig_bg_queue_status" style="font-size:0.7rem; color:var(--text-muted);">${automation.queuePaused ? "Paused" : (backgroundImageWorkerActive ? "Working" : "Idle")} · ${backgroundImageQueue.length} queued</span>
                            <i id="ig_bg_modes_chevron" class="fa-solid fa-chevron-down" style="color:var(--text-muted); transition:transform .2s; transform:${automation.panelOpen ? 'rotate(180deg)' : 'none'};"></i>
                        </div>
                    </div>
                    <div id="ig_bg_modes_body" style="display:${automation.panelOpen ? 'block' : 'none'}; padding:0 15px 15px;">
                    <div style="font-size:0.72rem; color:var(--text-muted); margin-bottom:14px;">These modes share one low-priority queue. RP continues normally, and completed images are attached to the message that started the job.</div>

                    <div class="ps-toggle-card ${automation.autoEnabled ? 'active' : ''}" id="ig_bg_auto_card" style="padding:12px 18px; margin-bottom:10px;">
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; font-size:0.85rem;">RP Auto-Generation</span>
                            <div style="margin-top:2px; font-size:0.68rem; color:var(--text-muted);">Builds prompts directly from UI pre-tags, matched character tags, participant/anatomy tags, and detected scene/position tags. No LLM.</div>
                        </div>
                        <div class="ps-switch"></div>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:16px;">
                        <div>
                            <div style="font-size:0.68rem; font-weight:bold; color:var(--text-muted); margin-bottom:4px;">Scene Trigger</div>
                            <select id="ig_bg_auto_trigger" class="ps-modern-input" style="padding:8px; font-size:0.75rem;">
                                <option value="explicit" ${automation.autoTriggerMode === 'explicit' ? 'selected' : ''}>Explicit scenes</option>
                                <option value="normal" ${automation.autoTriggerMode === 'normal' ? 'selected' : ''}>Normal scenes</option>
                                <option value="both" ${automation.autoTriggerMode === 'both' ? 'selected' : ''}>All scenes</option>
                                <option value="random" ${automation.autoTriggerMode === 'random' ? 'selected' : ''}>Random only</option>
                            </select>
                        </div>
                        <div>
                            <div style="font-size:0.68rem; font-weight:bold; color:var(--text-muted); margin-bottom:4px;">Random Chance %</div>
                            <input id="ig_bg_random_chance" type="number" min="0" max="100" class="ps-modern-input" value="${automation.autoRandomChance}" style="padding:8px; font-size:0.75rem;" />
                        </div>
                        <div>
                            <div style="font-size:0.68rem; font-weight:bold; color:var(--text-muted); margin-bottom:4px;">Cooldown Replies</div>
                            <input id="ig_bg_cooldown" type="number" min="0" max="100" class="ps-modern-input" value="${automation.cooldownReplies}" style="padding:8px; font-size:0.75rem;" />
                        </div>
                    </div>

                    <div class="ps-toggle-card ${automation.smartEnabled ? 'active' : ''}" id="ig_bg_qwen_card" style="padding:12px 18px; margin-bottom:10px;">
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; font-size:0.85rem;">Smart Qwen Mode (local)</span>
                            <div style="margin-top:2px; font-size:0.68rem; color:var(--text-muted);">Optional classifier/library router only. On a library miss, NanoGPT reads the RP scene plus configured UI/character/LoRA tags; Qwen never writes the image prompt.</div>
                        </div>
                        <div class="ps-switch"></div>
                    </div>
                    <div style="display:grid; grid-template-columns:minmax(0,1.5fr) minmax(160px,0.7fr); gap:10px; margin-bottom:10px;">
                        <input id="ig_bg_qwen_url" class="ps-modern-input" value="${psEscapeAttr(automation.qwenUrl)}" placeholder="http://127.0.0.1:8080/v1/chat/completions" style="padding:8px; font-size:0.75rem;" />
                        <input id="ig_bg_qwen_model" class="ps-modern-input" value="${psEscapeAttr(automation.qwenModel)}" placeholder="Qwen2-0.5B-Instruct" style="padding:8px; font-size:0.75rem;" />
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:16px;">
                        <label style="display:flex; align-items:center; gap:7px; font-size:0.72rem;"><input id="ig_bg_qwen_library" type="checkbox" ${automation.smartSearchLibrary ? 'checked' : ''}> Search batch library first</label>
                        <label style="display:flex; align-items:center; gap:7px; font-size:0.72rem;"><input id="ig_bg_qwen_fallback" type="checkbox" ${automation.smartGenerateFallback ? 'checked' : ''}> Generate when no match exists</label>
                        <div style="display:flex; align-items:center; gap:7px;">
                            <span style="font-size:0.68rem; color:var(--text-muted);">Confidence</span>
                            <input id="ig_bg_qwen_confidence" type="number" min="0" max="1" step="0.05" class="ps-modern-input" value="${automation.qwenMinConfidence}" style="padding:6px; font-size:0.72rem;" />
                        </div>
                        <button id="ig_bg_qwen_test" class="ps-modern-btn secondary" style="padding:7px 10px;"><i class="fa-solid fa-microchip"></i> Test Qwen</button>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; margin:-7px 0 16px; padding:8px 10px; border-radius:7px; background:rgba(168,85,247,.08); border:1px solid rgba(168,85,247,.18);">
                        <i class="fa-solid fa-satellite-dish" style="color:#a855f7;"></i>
                        <span style="font-size:.68rem; color:var(--text-muted);">Qwen activity:</span>
                        <span id="ig_bg_qwen_status" style="font-size:.7rem; color:var(--text-main); font-weight:700;">${psEscapeText(automation.qwenStatus || "Idle")}</span>
                    </div>

                    <div class="ps-toggle-card ${automation.batchEnabled ? 'active' : ''}" id="ig_bg_batch_card" style="padding:12px 18px; margin-bottom:10px;">
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; font-size:0.85rem;">Batch Library Generator</span>
                            <div style="margin-top:2px; font-size:0.68rem; color:var(--text-muted);">Queues known positions for analyzed characters. It stores images in the private library and never inserts them by itself.</div>
                        </div>
                        <div class="ps-switch"></div>
                    </div>
                    <textarea id="ig_bg_batch_positions" class="ps-modern-input" style="height:65px; resize:vertical; font-size:0.72rem; margin-bottom:10px;" placeholder="Missionary, Cowgirl, Doggy Style">${psEscapeText(automation.batchPositions.join(", "))}</textarea>
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                        <span style="font-size:0.68rem; color:var(--text-muted);">Male anatomy emphasis</span>
                        <select id="ig_bg_batch_male_anatomy" class="ps-modern-input" style="max-width:190px; padding:7px; font-size:0.72rem;">
                            <option value="standard" ${automation.batchMaleAnatomy === 'standard' ? 'selected' : ''}>Visible / standard</option>
                            <option value="large" ${automation.batchMaleAnatomy === 'large' ? 'selected' : ''}>Large penis</option>
                            <option value="huge" ${automation.batchMaleAnatomy === 'huge' ? 'selected' : ''}>Huge penis</option>
                        </select>
                        <span style="font-size:0.65rem; color:var(--text-muted);">Applied only when the selected act visibly involves a penis.</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                        <span style="font-size:0.68rem; color:var(--text-muted);">Images per character/position group</span>
                        <input id="ig_bg_batch_count" type="number" min="1" max="20" value="${Math.max(1, parseInt(automation.batchImagesPerGroup, 10) || 1)}" class="ps-modern-input" style="width:85px; padding:7px; font-size:.72rem;" />
                        <span style="font-size:0.65rem; color:var(--text-muted);">Initial batch fills each group to this count. Category Add buttons queue this many more.</span>
                    </div>
                    <div style="display:flex; gap:10px; flex-wrap:wrap;">
                        <button id="ig_bg_batch_start" class="ps-modern-btn primary" style="padding:7px 12px;"><i class="fa-solid fa-list-check"></i> Queue Character Batch</button>
                        <button id="ig_bg_queue_pause" class="ps-modern-btn secondary" style="padding:7px 12px;"><i class="fa-solid ${automation.queuePaused ? 'fa-play' : 'fa-pause'}"></i> ${automation.queuePaused ? 'Resume Queue' : 'Pause Queue'}</button>
                        <button id="ig_bg_queue_clear" class="ps-modern-btn secondary" style="padding:7px 12px;"><i class="fa-solid fa-ban"></i> Clear Pending</button>
                        <span style="align-self:center; font-size:0.7rem; color:var(--text-muted);">${automation.library.filter(item => item?.source === "batch" || item?.batchKey).length} ready batch image(s)</span>
                    </div>
                    <div style="margin-top:12px; border:1px solid var(--border-color); border-radius:8px; overflow:hidden;">
                        <div id="ig_bg_batch_library_header" style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 11px; cursor:pointer; user-select:none;">
                            <span style="font-size:.72rem; font-weight:800;"><i class="fa-solid fa-folder-tree" style="color:#a855f7;"></i> Batch Library Names</span>
                            <div style="display:flex; align-items:center; gap:9px;">
                                <span id="ig_bg_batch_library_count" style="font-size:.65rem; color:var(--text-muted);">${automation.library.filter(item => item?.source === "batch" || item?.batchKey).length} images</span>
                                <i id="ig_bg_batch_library_chevron" class="fa-solid fa-chevron-down" style="font-size:.7rem; color:var(--text-muted); transform:${automation.batchLibraryOpen ? 'rotate(180deg)' : 'none'};"></i>
                            </div>
                        </div>
                        <div id="ig_bg_batch_library_body" style="display:${automation.batchLibraryOpen ? 'flex' : 'none'}; flex-direction:column; gap:7px; padding:0 10px 10px;">${buildBatchLibraryInventoryHtml(automation)}</div>
                        <div style="padding:0 10px 9px; font-size:.61rem; color:var(--text-muted);">Delete removes entries from Megumin's Batch Library and Qwen matching. Saved image files remain on disk.</div>
                    </div>
                    </div>
                </div>

                <!-- Parameters Grid -->
                <div data-ig-collapse="image-parameters" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-sliders"></i> Image Parameters</div>

                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <select id="ig_model" class="ps-modern-input" style="flex: 2;"><option value="">Loading Models...</option></select>
                        <select id="ig_sampler" class="ps-modern-input" style="flex: 1;"><option value="">Loading Samplers...</option></select>
                        <select id="ig_scheduler" class="ps-modern-input" style="flex: 1;"><option value="">Loading Schedulers...</option></select>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 15px; background: rgba(0,0,0,0.1); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color);">
                        <!-- Steps -->
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="width: 50px; font-size: 0.8rem; font-weight: bold; color: var(--text-muted);">Steps</span>
                            <input type="range" id="ig_steps" min="1" max="100" value="${s.steps}" style="flex: 1; cursor: pointer;">
                            <input type="number" id="ig_steps_val" class="ps-modern-input" style="width: 50px; padding: 4px; text-align: center; font-size: 0.75rem;" value="${s.steps}">
                        </div>
                        <!-- CFG -->
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="width: 50px; font-size: 0.8rem; font-weight: bold; color: var(--text-muted);">CFG</span>
                            <input type="range" id="ig_cfg" min="1" max="30" step="0.5" value="${s.cfg}" style="flex: 1; cursor: pointer;">
                            <input type="number" id="ig_cfg_val" class="ps-modern-input" style="width: 50px; padding: 4px; text-align: center; font-size: 0.75rem;" value="${s.cfg}">
                        </div>
                        <!-- Denoise -->
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="width: 50px; font-size: 0.8rem; font-weight: bold; color: var(--text-muted);">Denoise</span>
                            <input type="range" id="ig_denoise" min="0" max="1" step="0.05" value="${s.denoise}" style="flex: 1; cursor: pointer;">
                            <input type="number" id="ig_denoise_val" class="ps-modern-input" style="width: 50px; padding: 4px; text-align: center; font-size: 0.75rem;" value="${s.denoise}">
                        </div>
                        <!-- Clip Skip -->
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="width: 50px; font-size: 0.8rem; font-weight: bold; color: var(--text-muted);">CLIP</span>
                            <input type="range" id="ig_clip" min="1" max="12" step="1" value="${s.clipSkip}" style="flex: 1; cursor: pointer;">
                            <input type="number" id="ig_clip_val" class="ps-modern-input" style="width: 50px; padding: 4px; text-align: center; font-size: 0.75rem;" value="${s.clipSkip}">
                        </div>
                    </div>

                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <div style="flex: 2;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Resolution Preset</div>
                            <select id="ig_res_preset" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;"></select>
                        </div>
                        <div style="flex: 1; display: flex; align-items: flex-end; gap: 5px;">
                            <input type="number" id="ig_w" class="ps-modern-input" value="${s.imgWidth}" placeholder="W" style="padding: 8px; text-align: center; font-size: 0.8rem;" />
                            <span style="color: var(--text-muted); padding-bottom: 8px;">x</span>
                            <input type="number" id="ig_h" class="ps-modern-input" value="${s.imgHeight}" placeholder="H" style="padding: 8px; text-align: center; font-size: 0.8rem;" />
                        </div>
                    </div>

                    <div style="display: flex; gap: 10px;">
                        <div style="flex: 1;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Seed (-1 for random)</div>
                            <input type="number" id="ig_seed" class="ps-modern-input" value="${s.customSeed}" style="padding: 8px; font-size: 0.8rem;" />
                        </div>
                        <div style="flex: 2;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Negative Prompt Override</div>
                            <input type="text" id="ig_neg" class="ps-modern-input" value="${s.customNegative}" style="padding: 8px; font-size: 0.8rem;" />
                        </div>
                    </div>
                </div>

                <!-- LoRA Lab -->
                <div data-ig-collapse="lora-lab" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-flask"></i> LoRA Lab</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        ${[1,2,3,4].map(i => `
                            <div style="background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); padding: 10px; border-radius: 8px; border-left: 3px solid #a855f7;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; gap: 8px;">
                                    <div style="font-size: 0.75rem; font-weight: bold; color: var(--text-muted);">Slot ${i}</div>
                                    <button type="button" id="ig_lora_lock_${i}" class="ps-modern-btn secondary ig-lora-lock-btn" title="Lock: match-keywords never changes this slot. Unlock to allow keyword swaps on empty or keyword-filled slots." style="padding: 4px 10px; font-size: 0.65rem; min-width: auto; border-radius: 6px;">
                                        <i class="fa-solid ${s.loraSlotLocked[i - 1] ? "fa-lock" : "fa-lock-open"}"></i>
                                    </button>
                                </div>
                                <select id="ig_lora_${i}" class="ps-modern-input" style="padding: 6px; font-size: 0.75rem; margin-bottom: 8px;"><option value="">Loading...</option></select>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: bold;">Wt: <span id="ig_lorawt_lbl_${i}" style="color: var(--text-main);">${i===1?s.selectedLoraWt:i===2?s.selectedLoraWt2:i===3?s.selectedLoraWt3:s.selectedLoraWt4}</span></span>
                                    <input type="range" id="ig_lorawt_${i}" min="-2" max="2" step="0.1" value="${i===1?s.selectedLoraWt:i===2?s.selectedLoraWt2:i===3?s.selectedLoraWt3:s.selectedLoraWt4}" style="flex: 1; cursor: pointer;">
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- LoRA Intelligence -->
                <div data-ig-collapse="lora-intelligence" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div data-ig-collapse-header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                        <div class="ps-rule-title" style="margin-bottom: 0; color: #a855f7;"><i class="fa-solid fa-brain"></i> LoRA Intelligence</div>
                        <div class="ps-toggle-card ${li.enabled ? 'active' : ''}" id="li_enable_toggle" style="padding: 8px 14px; min-width: 54px; justify-content: center; cursor: pointer; border-radius: 8px;">
                            <div class="ps-switch" style="transform: scale(0.8);"></div>
                        </div>
                    </div>

                    <div id="li_main_content" style="display: ${li.enabled ? 'block' : 'none'};">
                        <!-- Mode Toggles -->
                        <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px;">
                            <div class="ps-toggle-card ${li.ensureLoras ? 'active' : ''}" id="li_toggle_ensure" style="flex: 1; min-width: 200px; padding: 12px 16px; border-color: ${li.ensureLoras ? '#a855f7' : 'var(--border-color)'};">
                                <div style="display:flex; flex-direction:column;">
                                    <span style="font-weight:600; font-size:0.8rem; color: ${li.ensureLoras ? '#a855f7' : 'var(--text-main)'};">Ensure LoRA Usage</span>
                                    <div style="font-size:0.65rem; color:var(--text-muted); margin-top:2px;">AI prefers LoRAs over tags/descriptions</div>
                                </div>
                                <div class="ps-switch" style="transform: scale(0.75);"></div>
                            </div>
                            <div class="ps-toggle-card ${li.useDanbooruTags ? 'active' : ''}" id="li_toggle_tags" style="flex: 1; min-width: 200px; padding: 12px 16px; border-color: ${li.useDanbooruTags ? '#10b981' : 'var(--border-color)'};">
                                <div style="display:flex; flex-direction:column; width: 100%;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                        <span style="font-weight:600; font-size:0.8rem; color: ${li.useDanbooruTags ? '#10b981' : 'var(--text-main)'};">Booru Tags</span>
                                        <div class="ps-switch" style="transform: scale(0.75);"></div>
                                    </div>
                                    <div style="font-size:0.65rem; color:var(--text-muted); margin-top:2px; margin-bottom: 6px;">Assign & validate booru tags per character (facial/body features)</div>
                                    <div id="li_ensure_char_tag_wrap" style="display: ${li.useDanbooruTags ? 'flex' : 'none'}; align-items: center; gap: 8px; padding: 6px 8px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2); border-radius: 6px; cursor: pointer;" class="${li.ensureCharacterTag ? 'active' : ''}">
                                        <div style="width: 16px; height: 16px; border-radius: 4px; border: 2px solid ${li.ensureCharacterTag ? '#f59e0b' : '#52525b'}; background: ${li.ensureCharacterTag ? '#f59e0b' : 'transparent'}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                            ${li.ensureCharacterTag ? '<i class="fa-solid fa-check" style="font-size: 0.5rem; color: #000;"></i>' : ''}
                                        </div>
                                        <div style="display: flex; flex-direction: column;">
                                            <span style="font-size: 0.7rem; font-weight: 700; color: ${li.ensureCharacterTag ? '#f59e0b' : 'var(--text-muted)'};">Ensure Character Tag</span>
                                            <span style="font-size: 0.6rem; color: var(--text-muted);">Match each character to a famous anime/game character tag by appearance</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="ps-toggle-card ${li.useCharDescriptions ? 'active' : ''}" id="li_toggle_desc" style="flex: 1; min-width: 200px; padding: 12px 16px; border-color: ${li.useCharDescriptions ? '#3b82f6' : 'var(--border-color)'};">
                                <div style="display:flex; flex-direction:column; width: 100%;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                        <span style="font-weight:600; font-size:0.8rem; color: ${li.useCharDescriptions ? '#3b82f6' : 'var(--text-main)'};">Character Descriptions</span>
                                        <div class="ps-switch" style="transform: scale(0.75);"></div>
                                    </div>
                                    <div style="font-size:0.65rem; color:var(--text-muted); margin-top:2px; margin-bottom: 6px;">AI describes physical features in detail</div>
                                    <select id="li_desc_style" class="ps-modern-input" style="font-size: 0.7rem; padding: 4px; display: ${li.useCharDescriptions ? 'block' : 'none'};">
                                        <option value="booru" ${li.descriptionStyle === 'booru' ? 'selected' : ''}>Booru Style (tags)</option>
                                        <option value="natural" ${li.descriptionStyle === 'natural' ? 'selected' : ''}>Natural Language</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <!-- Prompt Assembly -->
                        <div data-ig-collapse="prompt-assembly" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                            <div data-ig-collapse-header style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                                <div style="flex: 1; min-width: 220px;">
                                    <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-main);">Prompt Assembly</div>
                                    <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 2px;">Character Guided gives the prompt model matched stable character references; LLM Full is looser.</div>
                                </div>
                                <select id="li_prompt_assembly_mode" class="ps-modern-input" style="width: 240px; padding: 8px; font-size: 0.75rem;">
                                    <option value="structured" ${li.promptAssemblyMode === 'structured' ? 'selected' : ''}>Character Guided LLM</option>
                                    <option value="llm" ${li.promptAssemblyMode === 'llm' ? 'selected' : ''}>LLM Full Prompt</option>
                                </select>
                                <select id="li_assignment_view_mode" class="ps-modern-input" style="width: 210px; padding: 8px; font-size: 0.75rem;">
                                    <option value="structured" ${li.assignmentViewMode === 'structured' ? 'selected' : ''}>Structured Fields</option>
                                    <option value="plain" ${li.assignmentViewMode === 'plain' ? 'selected' : ''}>Plain Text View</option>
                                </select>
                            </div>
                            <div style="display: ${li.useDanbooruTags ? 'grid' : 'none'}; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-top: 14px;">
                                ${liTagFieldToggle("li_field_character", "Character Tag", li.tagFieldToggles.characterTag)}
                                ${liTagFieldToggle("li_field_series", "Series Tag", li.tagFieldToggles.seriesTag)}
                                ${liTagFieldToggle("li_field_physical", "Physical", li.tagFieldToggles.physicalTags)}
                                ${liTagFieldToggle("li_field_clothing", "Clothing", li.tagFieldToggles.clothingTags)}
                            </div>
                        </div>

                        <!-- LoRA Browser -->
                        <div data-ig-collapse="lora-browser" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                            <div data-ig-collapse-header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-main);"><i class="fa-solid fa-folder-tree" style="color: #a855f7; margin-right: 6px;"></i>LoRA Browser</span>
                                    <select id="li_scope_select" class="ps-modern-input" style="width: auto; padding: 4px 10px; font-size: 0.7rem; font-weight: 600;">
                                        <option value="global" ${liScope === 'global' ? 'selected' : ''}>Global</option>
                                        <option value="character" ${liScope === 'character' ? 'selected' : ''}>Character Specific</option>
                                    </select>
                                </div>
                                <div style="display: flex; gap: 8px;">
                                    <button id="li_fetch_keywords_btn" class="ps-modern-btn secondary" style="padding: 4px 12px; font-size: 0.7rem;"><i class="fa-solid fa-key"></i> Fetch Keywords</button>
                                    <button id="li_refresh_btn" class="ps-modern-btn secondary" style="padding: 4px 12px; font-size: 0.7rem;"><i class="fa-solid fa-sync"></i> Refresh</button>
                                </div>
                            </div>
                            <div id="li_lora_list" style="max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;">
                                <div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 20px;">Loading LoRAs from ComfyUI...</div>
                            </div>
                        </div>

                        <!-- AI Character Assignment -->
                        <div data-ig-collapse="character-assignment" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                            <div data-ig-collapse-header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-main);"><i class="fa-solid fa-users-gear" style="color: var(--gold); margin-right: 6px;"></i>AI Character → LoRA Assignment</span>
                                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                    <button id="li_analysis_export_btn" class="ps-modern-btn secondary" title="Export assignments, booru fields, LoRA files, trigger keywords, and analysis-mode settings" style="padding: 6px 10px; font-size: 0.7rem;">
                                        <i class="fa-solid fa-file-export"></i> Export
                                    </button>
                                    <button id="li_analysis_import_btn" class="ps-modern-btn secondary" title="Restore a previously exported character-analysis snapshot" style="padding: 6px 10px; font-size: 0.7rem;">
                                        <i class="fa-solid fa-file-import"></i> Import
                                    </button>
                                    <input id="li_analysis_import_file" type="file" accept=".json,application/json" style="display:none;" />
                                    <button id="li_analyze_btn" class="ps-modern-btn primary" style="background: var(--gold); color: #000; padding: 6px 14px; font-size: 0.75rem; font-weight: 800;">
                                        <i class="fa-solid fa-bolt"></i> Analyze Characters
                                    </button>
                                </div>
                            </div>
                            <div id="li_assignment_table" style="min-height: 40px;">
                                ${liAssignments.length > 0 ? '' : '<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 15px; border: 1px dashed var(--border-color); border-radius: 8px;">No assignments yet. Click "Analyze Characters" to let AI map characters to LoRAs.</div>'}
                            </div>
                        </div>

                        <!-- Manual Render -->
                        <div data-ig-collapse="manual-render" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                            <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-keyboard"></i> Manual Render</div>
                            <div style="display:flex; gap: 10px; align-items: flex-end; margin-bottom: 12px; flex-wrap: wrap;">
                                <div style="flex: 1; min-width: 220px;">
                                    <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">NSFW Preset</div>
                                    <select id="ig_nsfw_position_preset" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;">
                                        ${NSFW_POSITION_PRESETS.map(p => `<option value="${psEscapeAttr(p.prompt)}">${psEscapeText(p.label)}</option>`).join("")}
                                    </select>
                                </div>
                                <button id="ig_apply_position_preset" class="ps-modern-btn secondary" style="padding: 8px 12px;"><i class="fa-solid fa-plus"></i> Add Preset</button>
                                <button id="ig_add_character_tags" class="ps-modern-btn secondary" style="padding: 8px 12px;"><i class="fa-solid fa-user-plus"></i> Add Character Tags</button>
                            </div>
                            <textarea id="ig_manual_prompt" class="ps-modern-input" style="height: 130px; resize: vertical; font-size: 0.85rem; line-height: 1.45; margin-bottom: 12px;" placeholder="Type the exact image prompt to render. This bypasses prompt generation but still uses current ComfyUI settings and LoRA slots.">${psEscapeText(s.manualPrompt || "")}</textarea>
                            <div style="display:flex; justify-content:flex-end; gap: 10px; flex-wrap: wrap;">
                                <button id="ig_manual_render_btn" class="ps-modern-btn primary" style="background: var(--gold); color: #000; font-weight: 800;"><i class="fa-solid fa-image"></i> Render Manual Prompt</button>
                            </div>
                        </div>

                        <!-- Debug Viewers -->
                        <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;">
                            <div id="li_prompt_preview_header" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; cursor: pointer; user-select: none;">
                                <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-main);"><i class="fa-solid fa-bug" style="color: #3b82f6; margin-right: 6px;"></i>Debug Viewers</span>
                                <i id="li_prompt_chevron" class="fa-solid fa-chevron-down" style="color: var(--text-muted); transition: transform 0.2s; transform:${s.sectionOpenStates["debug-viewers"] === true ? "rotate(180deg)" : "none"};"></i>
                            </div>
                            <div id="li_prompt_preview_body" style="display:${s.sectionOpenStates["debug-viewers"] === true ? "block" : "none"}; padding: 0 15px 15px 15px;">
                                <div id="li_last_comfy_api_wrap" style="margin-bottom: 14px;">
                                    <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px;">
                                        <span style="font-weight: 700; font-size: 0.8rem; color: var(--text-main);"><i class="fa-solid fa-paper-plane" style="color: #a855f7; margin-right: 6px;"></i>Last ComfyUI <span style="font-family: Consolas, Monaco, monospace; font-size: 0.78rem;">/prompt</span> request</span>
                                        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px;">
                                            <label for="li_last_comfy_req_view" style="font-size: 0.7rem; color: var(--text-muted); margin: 0;">View</label>
                                            <select id="li_last_comfy_req_view" class="ps-modern-input" style="width: auto; max-width: 280px; padding: 6px 10px; font-size: 0.75rem; cursor: pointer;">
                                                <option value="summary">Summary (prompts, LoRAs, samplers)</option>
                                                <option value="json">Full JSON (entire graph)</option>
                                            </select>
                                            <button type="button" id="li_last_comfy_req_copy" class="ps-modern-btn secondary" style="padding: 6px 12px; font-size: 0.7rem;"><i class="fa-solid fa-copy"></i> Copy</button>
                                        </div>
                                    </div>
                                    <textarea id="li_last_comfy_req_body" readonly class="ps-modern-input" style="height: 220px; resize: vertical; font-family: Consolas, Monaco, monospace; font-size: 0.72rem; background: #0c0c0e; color: var(--text-main); cursor: default;" spellcheck="false"></textarea>
                                </div>
                                <div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px;">
                                        <span style="font-weight: 700; font-size: 0.8rem; color: var(--text-main);"><i class="fa-solid fa-users-gear" style="color: var(--gold); margin-right: 6px;"></i>Last character analysis response</span>
                                        <button type="button" id="li_last_analysis_copy" class="ps-modern-btn secondary" style="padding: 6px 12px; font-size: 0.7rem;"><i class="fa-solid fa-copy"></i> Copy</button>
                                    </div>
                                    <textarea id="li_last_analysis_body" readonly class="ps-modern-input" style="height: 180px; resize: vertical; font-family: Consolas, Monaco, monospace; font-size: 0.72rem; background: #0c0c0e; color: var(--text-main); cursor: default;" spellcheck="false">${psEscapeText(li.lastCharacterAnalysisResponse || "")}</textarea>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `);

        // Keep automation beside the character data it consumes instead of among core render parameters.
        const $backgroundModesPanel = $("#ig_bg_modes_panel").detach();
        const $characterAnalysisCard = $("#li_assignment_table").closest("div[style*='background: rgba(0,0,0,0.2)']");
        if ($backgroundModesPanel.length && $characterAnalysisCard.length) {
            $backgroundModesPanel.insertAfter($characterAnalysisCard);
        }
        setupImageGenCollapsibleSections(s);

        // --- EVENTS & BINDINGS ---
        $("#ig_enable_card").on("click", function() {
            s.enabled = !s.enabled;
            saveProfileToMemory();
            toggleQuickGenButton(); // <-- ADDED
            if (s.enabled) { $(this).addClass("active"); $(this).css("border-color", "var(--gold)"); $(this).find("span").css("color", "var(--gold)"); $("#ig_main_content").slideDown(200); igFetchComfyLists(); }
            else { $(this).removeClass("active"); $(this).css("border-color", "var(--border-color)"); $(this).find("span").css("color", "var(--text-main)"); $("#ig_main_content").slideUp(200); }
        });
        $("#img_gen_backend").on("change", function() {
            s.generatorBackend = $(this).val();
            saveProfileToMemory();
        });

        $("#ig_trigger_mode").on("change", (e) => {
            s.triggerMode = $(e.target).val();
            saveProfileToMemory();
            toggleQuickGenButton(); // <-- ADDED
            if (s.triggerMode === 'frequency') $("#ig_freq_container").show(); else $("#ig_freq_container").hide();
        });
        $("#ig_auto_freq").on("input", (e) => { let v = parseInt($(e.target).val()); if(v<1)v=1; s.autoGenFreq = v; saveProfileToMemory(); });

        $("#ig_preview_card").on("click", function() {
            s.previewPrompt = !s.previewPrompt;
            saveProfileToMemory();
            if (s.previewPrompt) $(this).addClass("active");
            else $(this).removeClass("active");
        });
        $("#ig_manual_scene_selector_card").on("click", function() {
            s.manualSceneSelector = !s.manualSceneSelector;
            saveProfileToMemory();
            $(this).toggleClass("active", s.manualSceneSelector);
        });
        $("#ig_manual_prompt_source").on("change", (e) => {
            s.manualPromptSource = $(e.target).val() || "comfy_llm";
            saveProfileToMemory();
        });
        $("#ig_structured_rules_card").on("click", function() {
            s.structuredPromptRules = !s.structuredPromptRules;
            saveProfileToMemory();
            $(this).toggleClass("active", s.structuredPromptRules);
        });
        $("#ig_adult_precision_card").on("click", function() {
            s.adultTagPrecision = !s.adultTagPrecision;
            saveProfileToMemory();
            $(this).toggleClass("active", s.adultTagPrecision);
        });
        $("#ig_prompt_examples_card").on("click", function() {
            s.includePromptExamples = !s.includePromptExamples;
            saveProfileToMemory();
            $(this).toggleClass("active", s.includePromptExamples);
        });
        $("#ig_bg_modes_header").on("click", function() {
            automation.panelOpen = !automation.panelOpen;
            saveProfileToMemory();
            $("#ig_bg_modes_body").stop(true, true).slideToggle(180);
            $("#ig_bg_modes_chevron").css("transform", automation.panelOpen ? "rotate(180deg)" : "none");
        });
        $("#ig_bg_auto_card").on("click", function() {
            automation.autoEnabled = !automation.autoEnabled;
            saveProfileToMemory();
            $(this).toggleClass("active", automation.autoEnabled);
        });
        $("#ig_bg_auto_trigger").on("change", (e) => { automation.autoTriggerMode = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_bg_random_chance").on("input", (e) => {
            automation.autoRandomChance = Math.max(0, Math.min(100, parseInt($(e.target).val(), 10) || 0));
            saveProfileToMemory();
        });
        $("#ig_bg_cooldown").on("input", (e) => {
            automation.cooldownReplies = Math.max(0, parseInt($(e.target).val(), 10) || 0);
            saveProfileToMemory();
        });
        $("#ig_bg_qwen_card").on("click", function() {
            automation.smartEnabled = !automation.smartEnabled;
            saveProfileToMemory();
            $(this).toggleClass("active", automation.smartEnabled);
        });
        $("#ig_bg_qwen_url").on("input", (e) => { automation.qwenUrl = $(e.target).val().trim(); saveProfileToMemory(); });
        $("#ig_bg_qwen_model").on("input", (e) => { automation.qwenModel = $(e.target).val().trim(); saveProfileToMemory(); });
        $("#ig_bg_qwen_library").on("change", (e) => { automation.smartSearchLibrary = !!e.target.checked; saveProfileToMemory(); });
        $("#ig_bg_qwen_fallback").on("change", (e) => { automation.smartGenerateFallback = !!e.target.checked; saveProfileToMemory(); });
        $("#ig_bg_qwen_confidence").on("input", (e) => {
            automation.qwenMinConfidence = Math.max(0, Math.min(1, parseFloat($(e.target).val()) || 0));
            saveProfileToMemory();
        });
        $("#ig_bg_qwen_test").on("click", async function() {
            const btn = $(this);
            btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> Testing...');
            setQwenStatus("Testing local endpoint…");
            try {
                const result = await classifySceneWithLocalQwen("Two adults are talking together in a quiet room.", [], automation);
                setQwenStatus(`Connected · ${result.sceneType || "normal"} · ${Math.round((result.confidence || 0) * 100)}%`);
                toastr.success(`Qwen connected: ${result.sceneType || "normal"} (${Math.round((result.confidence || 0) * 100)}%)`);
            } catch (e) {
                setQwenStatus(`Error · ${e.message}`);
                toastr.error("Qwen connection failed: " + e.message);
            } finally {
                btn.prop("disabled", false).html('<i class="fa-solid fa-microchip"></i> Test Qwen');
            }
        });
        $("#ig_bg_batch_card").on("click", function() {
            automation.batchEnabled = !automation.batchEnabled;
            saveProfileToMemory();
            $(this).toggleClass("active", automation.batchEnabled);
        });
        $("#ig_bg_batch_positions").on("input", (e) => {
            automation.batchPositions = String($(e.target).val() || "").split(",").map(v => v.trim()).filter(Boolean);
            saveProfileToMemory();
        });
        $("#ig_bg_batch_male_anatomy").on("change", (e) => {
            automation.batchMaleAnatomy = $(e.target).val() || "standard";
            saveProfileToMemory();
        });
        $("#ig_bg_batch_count").on("input", (e) => {
            automation.batchImagesPerGroup = Math.max(1, Math.min(20, parseInt($(e.target).val(), 10) || 1));
            saveProfileToMemory();
            refreshBatchLibraryInventory();
        });
        $("#ig_bg_batch_library_header").on("click", function() {
            automation.batchLibraryOpen = !automation.batchLibraryOpen;
            saveProfileToMemory();
            $("#ig_bg_batch_library_body").stop(true, true).slideToggle(160);
            $("#ig_bg_batch_library_chevron").css("transform", automation.batchLibraryOpen ? "rotate(180deg)" : "none");
        });
        $("#ig_bg_batch_library_body").on("click", ".ig-batch-group-add", function() {
            try {
                const character = String($(this).attr("data-character") || "");
                const position = String($(this).attr("data-position") || "");
                const count = queueBatchCategoryJobs(character, position, Math.max(1, parseInt(automation.batchImagesPerGroup, 10) || 1), true);
                if (count > 0) toastr.success(`Queued ${count} more ${character} / ${position} image(s).`);
            } catch (e) {
                toastr.error(e.message || "Could not queue category images.");
            }
        });
        $("#ig_bg_batch_library_body").on("click", ".ig-batch-item-delete", function() {
            const id = String($(this).attr("data-library-id") || "");
            const item = automation.library.find(entry => entry.id === id);
            if (!item) return;
            if (!window.confirm(`Remove "${getBatchLibraryFilename(item)}" from the Batch Library?\n\nThe saved image file will remain on disk.`)) return;
            automation.library = automation.library.filter(entry => entry.id !== id);
            saveProfileToMemory();
            refreshBatchLibraryInventory();
            toastr.success("Batch Library entry removed.");
        });
        $("#ig_bg_batch_library_body").on("click", ".ig-batch-group-delete", function() {
            const character = String($(this).attr("data-character") || "");
            const position = String($(this).attr("data-position") || "");
            const matches = automation.library.filter(item =>
                (item?.source === "batch" || item?.batchKey) &&
                getBatchLibraryPrimaryCharacter(item) === character &&
                String(item.position || "Uncategorized") === position
            );
            if (!matches.length) return;
            if (!window.confirm(`Remove all ${matches.length} "${character} / ${position}" entries from the Batch Library?\n\nSaved image files will remain on disk.`)) return;
            const ids = new Set(matches.map(item => item.id));
            automation.library = automation.library.filter(item => !ids.has(item.id));
            saveProfileToMemory();
            refreshBatchLibraryInventory();
            toastr.success(`Removed ${matches.length} Batch Library entries.`);
        });
        $("#ig_bg_batch_start").on("click", async function() {
            try {
                const count = queueCharacterBatchJobs();
                if (count > 0) toastr.success(`Queued ${count} batch image job(s).`);
            } catch (e) {
                toastr.error(e.message || "Could not queue batch images.");
            }
        });
        $("#ig_bg_queue_pause").on("click", function() {
            automation.queuePaused = !automation.queuePaused;
            saveProfileToMemory();
            $(this).html(`<i class="fa-solid ${automation.queuePaused ? 'fa-play' : 'fa-pause'}"></i> ${automation.queuePaused ? 'Resume Queue' : 'Pause Queue'}`);
            refreshBackgroundQueueStatus();
            if (!automation.queuePaused) processBackgroundImageQueue();
            else toastr.info("Queue paused. The active image will finish; pending jobs will wait.");
        });
        $("#ig_bg_queue_clear").on("click", function() {
            const removed = backgroundImageQueue.length;
            while (backgroundImageQueue.length) {
                const job = backgroundImageQueue.shift();
                if (job?.originKey) backgroundOriginKeys.delete(job.originKey);
            }
            refreshBackgroundQueueStatus();
            toastr.info(`Cleared ${removed} pending job(s). The active render will finish normally.`);
        });

        // Inputs
        $("#ig_url").on("input", (e) => {
            meguminComfyLoraCache = null;
            meguminComfyLoraCacheUrl = "";
            s.comfyUrl = $(e.target).val();
            saveProfileToMemory();
        });
        $("#ig_runpod_card").on("click", function() {
            const rp = ensureRunpodSettings(s);
            rp.enabled = !rp.enabled;
            if (rp.enabled && ensureRunpodDropdownValues(s)) {
                toastr.info("RunPod model defaults applied.");
            }
            saveProfileToMemory();
            $(this).toggleClass("active", rp.enabled);
            if (rp.enabled) $("#ig_runpod_settings").slideDown(200);
            else $("#ig_runpod_settings").slideUp(200);
            if (rp.enabled) populateRunpodImageLists(s);
            else igFetchComfyLists();
        });
        $("#ig_runpod_endpoint").on("input", (e) => {
            const value = $(e.target).val().trim();
            getRunpodGlobalSettings().endpointId = value;
            ensureRunpodSettings(s).endpointId = value;
            saveProfileToMemory();
        });
        $("#ig_runpod_key").on("input", (e) => {
            const value = $(e.target).val().trim();
            getRunpodGlobalSettings().apiKey = value;
            ensureRunpodSettings(s).apiKey = value;
            saveProfileToMemory();
        });
        $("#ig_runpod_poll").on("input", (e) => {
            const rp = ensureRunpodSettings(s);
            rp.pollIntervalMs = Math.max(500, parseInt($(e.target).val(), 10) || RUNPOD_IMAGE_DEFAULTS.pollIntervalMs);
            saveProfileToMemory();
        });
        $("#ig_runpod_timeout").on("input", (e) => {
            const rp = ensureRunpodSettings(s);
            rp.timeoutMs = Math.max(30000, parseInt($(e.target).val(), 10) || RUNPOD_IMAGE_DEFAULTS.timeoutMs);
            saveProfileToMemory();
        });
        $("#ig_style").on("change", (e) => { s.promptStyle = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_persp").on("change", (e) => { s.promptPerspective = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_anima_max_tags").on("input", (e) => {
            let v = parseInt($(e.target).val());
            if (!Number.isFinite(v) || v < 0) v = 0;
            if (v > 300) v = 300;
            s.animaMaxTags = v;
            saveProfileToMemory();
        });
        $("#ig_std_booru_lead").on("input", (e) => { s.standardBooruLeadTags = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_extra").on("input", (e) => { s.promptExtra = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_w, #ig_h").on("input", (e) => { s[e.target.id === "ig_w" ? "imgWidth" : "imgHeight"] = parseInt($(e.target).val()); saveProfileToMemory(); });
        $("#ig_neg").on("input", (e) => { s.customNegative = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_seed").on("input", (e) => { s.customSeed = parseInt($(e.target).val()); saveProfileToMemory(); });

        // Sliders
        const bindSlider = (id, key, isFloat) => {
            $(`#ig_${id}`).on("input", function() { let v = isFloat ? parseFloat(this.value) : parseInt(this.value); s[key] = v; $(`#ig_${id}_val`).val(v); saveProfileToMemory(); });
            $(`#ig_${id}_val`).on("input", function() { let v = isFloat ? parseFloat(this.value) : parseInt(this.value); s[key] = v; $(`#ig_${id}`).val(v); saveProfileToMemory(); });
        };
        bindSlider("steps", "steps", false); bindSlider("cfg", "cfg", true); bindSlider("denoise", "denoise", true); bindSlider("clip", "clipSkip", false);

        // Resolutions
        const resSel = $("#ig_res_preset");
        resSel.empty().append('<option value="">-- Select Preset --</option>');
        RESOLUTIONS.forEach((r, idx) => resSel.append(`<option value="${idx}">${r.label}</option>`));
        resSel.on("change", (e) => {
            const idx = parseInt($(e.target).val());
            if (!isNaN(idx) && RESOLUTIONS[idx]) { $("#ig_w").val(RESOLUTIONS[idx].w).trigger("input"); $("#ig_h").val(RESOLUTIONS[idx].h).trigger("input"); }
        });

        // LoRAs
        for(let i=1; i<=4; i++) {
            const key = i===1 ? "selectedLora" : `selectedLora${i}`;
            const wtKey = i===1 ? "selectedLoraWt" : `selectedLoraWt${i}`;
            $(`#ig_lora_${i}`).on("change", (e) => {
                s[key] = $(e.target).val();
                ensureImageGenLoraArrays(s);
                s.loraSlotKeywordManaged[i - 1] = false;
                saveProfileToMemory();
            });
            $(`#ig_lorawt_${i}`).on("input", function() { let v = parseFloat(this.value); s[wtKey] = v; $(`#ig_lorawt_lbl_${i}`).text(v); saveProfileToMemory(); });
            $(`#ig_lora_lock_${i}`).on("click", function() {
                ensureImageGenLoraArrays(s);
                s.loraSlotLocked[i - 1] = !s.loraSlotLocked[i - 1];
                $(this).find("i").attr("class", s.loraSlotLocked[i - 1] ? "fa-solid fa-lock" : "fa-solid fa-lock-open");
                saveProfileToMemory();
            });
        }

        // Models & Samplers
        $("#ig_model").on("change", (e) => { s.selectedModel = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_sampler").on("change", (e) => { s.selectedSampler = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_scheduler").on("change", (e) => { s.selectedScheduler = $(e.target).val(); saveProfileToMemory(); });

        // Buttons
        $("#ig_test_btn").on("click", igTestConnection);

        // Workflow Managers
        $("#ig_new_wf").on("click", igNewWorkflowClick);
        $("#ig_edit_wf").on("click", igOpenWorkflowEditorClick);
        $("#ig_del_wf").on("click", igDeleteWorkflowClick);
        $("#ig_workflow_list").on("change", (e) => {
            const newWorkflow = $(e.target).val();
            const oldWorkflow = s.currentWorkflowName;
            if (oldWorkflow) {
                if (!s.savedWorkflowStates) s.savedWorkflowStates = {};
                s.savedWorkflowStates[oldWorkflow] = {
                    selectedModel: s.selectedModel, selectedSampler: s.selectedSampler, selectedScheduler: s.selectedScheduler, steps: s.steps, cfg: s.cfg, denoise: s.denoise, clipSkip: s.clipSkip,
                    imgWidth: s.imgWidth, imgHeight: s.imgHeight, customSeed: s.customSeed, customNegative: s.customNegative,
                    promptStyle: s.promptStyle, promptPerspective: s.promptPerspective, promptExtra: s.promptExtra, animaMaxTags: s.animaMaxTags, standardBooruLeadTags: s.standardBooruLeadTags, previewPrompt: s.previewPrompt,
                    structuredPromptRules: s.structuredPromptRules, adultTagPrecision: s.adultTagPrecision, includePromptExamples: s.includePromptExamples,
                    manualSceneSelector: s.manualSceneSelector,
                    selectedLora: s.selectedLora, selectedLoraWt: s.selectedLoraWt, selectedLora2: s.selectedLora2, selectedLoraWt2: s.selectedLoraWt2,
                    selectedLora3: s.selectedLora3, selectedLoraWt3: s.selectedLoraWt3, selectedLora4: s.selectedLora4, selectedLoraWt4: s.selectedLoraWt4,
                    loraSlotLocked: [...(s.loraSlotLocked || [false, false, false, false])],
                    loraSlotKeywordManaged: [...(s.loraSlotKeywordManaged || [false, false, false, false])]
                };
            }
            if (s.savedWorkflowStates && s.savedWorkflowStates[newWorkflow]) {
                Object.assign(s, s.savedWorkflowStates[newWorkflow]);
                toastr.success(`Restored settings for ${newWorkflow}`);
                renderImageGen(c); // Re-render to update UI with restored values
            } else { toastr.info(`New workflow context active`); }

            s.currentWorkflowName = newWorkflow;
            saveProfileToMemory();
        });

        if (s.enabled) {
            igPopulateWorkflows();
            igFetchComfyLists();
        }

        // --- LoRA Intelligence Event Bindings ---
        $("#li_enable_toggle").on("click", function() {
            li.enabled = !li.enabled; saveProfileToMemory(); renderImageGen(c);
        });
        $("#li_toggle_ensure").on("click", function() { li.ensureLoras = !li.ensureLoras; saveProfileToMemory(); renderImageGen(c); });
        $("#li_toggle_tags").on("click", function(e) {
            if ($(e.target).closest("#li_ensure_char_tag_wrap").length) return;
            li.useDanbooruTags = !li.useDanbooruTags; saveProfileToMemory(); renderImageGen(c);
        });
        $("#li_ensure_char_tag_wrap").on("click", function(e) {
            e.stopPropagation();
            li.ensureCharacterTag = !li.ensureCharacterTag; saveProfileToMemory(); renderImageGen(c);
        });
        const bindLiTagToggle = (id, key) => {
            $(`#${id}`).on("click", function() {
                li.tagFieldToggles[key] = !li.tagFieldToggles[key];
                saveProfileToMemory();
                renderImageGen(c);
            });
        };
        bindLiTagToggle("li_field_character", "characterTag");
        bindLiTagToggle("li_field_series", "seriesTag");
        bindLiTagToggle("li_field_physical", "physicalTags");
        bindLiTagToggle("li_field_clothing", "clothingTags");
        $("#ig_manual_render_btn").on("click", igRenderManualPrompt);
        $("#ig_manual_prompt").on("input", (e) => { s.manualPrompt = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_apply_position_preset").on("click", () => applyPromptPresetToTextarea("#ig_nsfw_position_preset", "#ig_manual_prompt", s, "manualPrompt"));
        $("#ig_add_character_tags").on("click", () => igAddCharacterInfoToManualPrompt(s, li, charKey));
        $("#li_toggle_desc").on("click", function(e) {
            if ($(e.target).is("select") || $(e.target).is("option")) return;
            li.useCharDescriptions = !li.useCharDescriptions;
            saveProfileToMemory();
            renderImageGen(c);
        });
        $("#li_desc_style").on("change", function(e) {
            li.descriptionStyle = $(this).val();
            saveProfileToMemory();
        });
        $("#li_prompt_assembly_mode").on("change", function() {
            li.promptAssemblyMode = $(this).val();
            saveProfileToMemory();
        });
        $("#li_assignment_view_mode").on("change", function() {
            li.assignmentViewMode = $(this).val();
            saveProfileToMemory();
            renderImageGen(c);
        });

        // Scope select
        $("#li_scope_select").on("change", function() {
            const scope = $(this).val();
            if (scope === "character" && !li.characterActiveLoras[charKey]) {
                li.characterActiveLoras[charKey] = JSON.parse(JSON.stringify(li.globalActiveLoras));
            }
            saveProfileToMemory();
            liPopulateLoraList(s, li, charKey);
        });

        // Prompt preview toggle
        $("#li_prompt_preview_header").on("click", function() {
            const body = $("#li_prompt_preview_body");
            const chevron = $("#li_prompt_chevron");
            const nextOpen = !body.is(":visible");
            s.sectionOpenStates["debug-viewers"] = nextOpen;
            saveProfileToMemory();
            if (nextOpen) { body.slideDown(200); chevron.css("transform", "rotate(180deg)"); }
            else { body.slideUp(200); chevron.css("transform", "rotate(0deg)"); }
        });
        $("#li_last_comfy_req_view").on("change", function() { igRefreshLastComfyApiPanel(); });
        $("#li_last_comfy_req_copy").on("click", async function() {
            const t = $("#li_last_comfy_req_body").val();
            try {
                await navigator.clipboard.writeText(t);
                toastr.success("Copied to clipboard");
            } catch (e) {
                toastr.error("Copy failed");
            }
        });
        $("#li_last_analysis_copy").on("click", async function() {
            const t = $("#li_last_analysis_body").val();
            try {
                await navigator.clipboard.writeText(t);
                toastr.success("Copied to clipboard");
            } catch (e) {
                toastr.error("Copy failed");
            }
        });
        $("#li_analysis_export_btn").on("click", function() {
            const scope = $("#li_scope_select").val() || "global";
            downloadCharacterAnalysisSnapshot(li, charKey, scope);
            toastr.success(`Exported ${countModeCharacterAssignments(li, charKey)} ${getAssignmentModeLabel(li)} character assignments.`);
        });
        $("#li_analysis_import_btn").on("click", function() {
            $("#li_analysis_import_file").trigger("click");
        });
        $("#li_analysis_import_file").on("change", function(e) {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const payload = JSON.parse(String(event.target.result || ""));
                    const sourceNote = payload.sourceCharacterKey && payload.sourceCharacterKey !== charKey
                        ? ` It was exported from "${payload.sourceCharacterKey}" and will restore into the current character.`
                        : "";
                    if (!window.confirm(`Replace the current character-analysis assignments, active LoRA keyword list, and mode settings with this snapshot?${sourceNote}`)) return;
                    const restored = applyCharacterAnalysisSnapshot(li, charKey, payload);
                    saveProfileToMemory();
                    renderImageGen(c);
                    toastr.success(`Restored ${restored.count} assignments (${restored.mode} mode).`);
                } catch (error) {
                    console.error("[Megumin Suite] Character-analysis import failed:", error);
                    toastr.error(error.message || "Character-analysis import failed.");
                }
            };
            reader.onerror = () => toastr.error("Could not read the snapshot file.");
            reader.readAsText(file);
            $(this).val("");
        });
        igRefreshLastComfyApiPanel();

        // Refresh LoRA list
        $("#li_refresh_btn").on("click", async function() {
            $(this).prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i>');
            await liPopulateLoraList(s, li, charKey, true);
            $(this).prop("disabled", false).html('<i class="fa-solid fa-sync"></i> Refresh');
        });

        // Fetch keywords from Civitai for all active LoRAs
        $("#li_fetch_keywords_btn").on("click", async function() {
            const btn = $(this);
            btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> Fetching...');
            const scope = $("#li_scope_select").val();
            const activeList = scope === "character" && li.characterActiveLoras[charKey] ? li.characterActiveLoras[charKey] : li.globalActiveLoras;
            const enabledLoras = activeList.filter(l => l.enabled);
            if (enabledLoras.length === 0) { toastr.warning("No active LoRAs to fetch keywords for."); btn.prop("disabled", false).html('<i class="fa-solid fa-key"></i> Fetch Keywords'); return; }

            let fetched = 0;
            for (const lora of enabledLoras) {
                if (lora.keywords && lora.keywords.length > 0) continue;
                const keywords = await fetchCivitaiKeywords(lora.name);
                if (keywords) { lora.keywords = keywords; fetched++; }
            }
            saveProfileToMemory();
            liPopulateLoraList(s, li, charKey);
            if (fetched > 0) toastr.success(`Fetched keywords for ${fetched} LoRAs!`);
            else toastr.info("No new keywords found. Some LoRAs may not have Civitai entries.");
            btn.prop("disabled", false).html('<i class="fa-solid fa-key"></i> Fetch Keywords');
        });

        // AI Character Assignment
        $("#li_analyze_btn").on("click", async function() {
            const btn = $(this);
            const chatText = getCleanedChatHistory();
            if (chatText.length < 50) return toastr.warning("Not enough chat history to analyze characters.");

            btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> Refreshing LoRAs...');
            const loraRefreshOk = await liPopulateLoraList(s, li, charKey, true);
            if (!loraRefreshOk) {
                btn.prop("disabled", false).html('<i class="fa-solid fa-bolt"></i> Analyze Characters');
                return toastr.error("Could not refresh the current LoRA list. Character analysis was not started.");
            }

            const scope = $("#li_scope_select").val();
            const activeList = scope === "character" && li.characterActiveLoras[charKey] ? li.characterActiveLoras[charKey] : li.globalActiveLoras;
            const enabledLoras = activeList.filter(l => l.enabled);

            btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...');

            try {
                if (li.useDanbooruTags) await loadDanbooruTags();

                const loraListStr = enabledLoras.map(l => {
                    const keywords = getEffectiveLoraKeywords(l);
                    const kw = keywords.length > 0 ? ` (keywords: ${keywords.join(', ')})` : '';
                    return `- ${l.name}${kw}`;
                }).join('\n');
                const characterTextContext = getCurrentCharacterTextContext();

                activeLoraAssignRequest = {
                    chatText: chatText,
                    cardDescription: characterTextContext.description,
                    firstMessage: characterTextContext.firstMessage,
                    loraList: loraListStr,
                    hasLoras: enabledLoras.length > 0,
                    ensureLoras: li.ensureLoras,
                    useTags: li.useDanbooruTags,
                    ensureCharacterTag: li.ensureCharacterTag,
                    useDescriptions: li.useCharDescriptions,
                    descStyle: li.descriptionStyle
                };

                let rawOutput;
                if (s.generatorBackend === "direct") {
                    rawOutput = await generateQuietPrompt({ prompt: "___PS_LORA_ASSIGN___" });
                } else {
                    let presetResult;
                    await useMeguminEngine(async () => {
                        presetResult = await generateQuietPrompt({ prompt: "___PS_LORA_ASSIGN___" });
                    });
                    rawOutput = presetResult;
                }
                activeLoraAssignRequest = null;

                if (!rawOutput) {
                    toastr.warning("AI returned empty response. Try again.");
                    btn.prop("disabled", false).html('<i class="fa-solid fa-bolt"></i> Analyze Characters');
                    return;
                }
                rawOutput = stripUtilityThinkingWrapper(rawOutput);
                li.lastCharacterAnalysisResponse = rawOutput;
                $("#li_last_analysis_body").val(rawOutput);
                saveProfileToMemory();

                // Parse the AI response
                try {
                    let jsonText = rawOutput;
                    let jsonMatch = jsonText.match(/\[[\s\S]*\]/);
                    if (!jsonMatch) {
                        const trimmed = jsonText.trim();
                        if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
                            jsonText = '[' + trimmed;
                            if (!jsonText.trim().endsWith(']')) jsonText = jsonText.trim() + ']';
                            jsonMatch = jsonText.match(/\[[\s\S]*\]/);
                        }
                    }
                    if (jsonMatch) {
                        const assignments = JSON.parse(jsonMatch[0]);

                        if (li.useDanbooruTags) {
                            for (const a of assignments) {
                                ensureStructuredCharacterAssignment(a);
                                ['booru_tags', 'character_tag', 'series_tag', 'physical_tags', 'clothing_tags'].forEach(key => {
                                    if (!a[key]) return;
                                    const repairedTags = danbooruTagsMap && danbooruTagsMap.size > 0 ? repairBooruTags(a[key]) : a[key];
                                    a[key] = normalizeGeneratedTagField(repairedTags);
                                });
                                normalizeStructuredCharacterAssignment(a);
                            }
                        }

                        setModeCharacterAssignments(li, charKey, assignments);
                        saveProfileToMemory();
                        liRenderAssignmentTable(li, charKey, s);
                        toastr.success(`Mapped ${assignments.length} characters!`);
                    } else {
                        toastr.warning("AI response couldn't be parsed. Try again.");
                        console.log("[Megumin Suite] Raw LoRA assignment output:", rawOutput);
                    }
                } catch (parseErr) {
                    toastr.warning("Failed to parse AI assignment response.");
                    console.error("[Megumin Suite] Parse error:", parseErr, rawOutput);
                }
            } catch (e) {
                toastr.error("Character analysis failed.");
                console.error(e);
            } finally {
                activeLoraAssignRequest = null;
                btn.prop("disabled", false).html('<i class="fa-solid fa-bolt"></i> Analyze Characters');
            }
        });

        // Populate LoRA browser if enabled
        if (s.enabled && li.enabled) {
            liPopulateLoraList(s, li, charKey);
            liRenderAssignmentTable(li, charKey, s);
        }
    }

    function renderVideoGen(c) {
        c.empty();
        const s = getLocalProfile().videoGen;
        const workflowPath = s.workflowPath || "wan-api.json";
        const negative = psEscapeText(s.customNegative || "");
        const locked = !!s.settingsLocked;
        const lockDisabled = locked ? "disabled" : "";
        const lockStyle = locked ? "opacity: 0.65; pointer-events: none;" : "";

        c.append(`
            <div class="ps-toggle-card ${s.enabled ? 'active' : ''}" id="vg_enable_card" style="border-color: ${s.enabled ? 'var(--gold)' : 'var(--border-color)'};">
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:700; font-size: 1.1rem; color: ${s.enabled ? 'var(--gold)' : 'var(--text-main)'};"><i class="fa-solid fa-video"></i> Enable Video Generation</span>
                    <div style="margin-top:4px; font-size: 0.8rem; color: var(--text-muted);">Use ${psEscapeText(workflowPath)} as a WAN ComfyUI API workflow for this character/group.</div>
                </div>
                <div class="ps-switch"></div>
            </div>

            <div id="vg_main_content" style="display: ${s.enabled ? 'block' : 'none'};">
                <div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap: 12px; margin-bottom: 12px;">
                        <div class="ps-rule-title" style="margin-bottom: 0;"><i class="fa-solid fa-link"></i> ComfyUI Server & WAN Workflow</div>
                        <button id="vg_lock_settings" class="ps-modern-btn secondary" title="Lock video settings except frame images" style="padding: 7px 12px; color: ${locked ? 'var(--gold)' : 'var(--text-main)'}; border-color: ${locked ? 'rgba(245,158,11,0.45)' : 'var(--border-color)'};">
                            <i class="fa-solid ${locked ? 'fa-lock' : 'fa-lock-open'}"></i> ${locked ? 'Locked' : 'Lock'}
                        </button>
                    </div>
                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <input type="text" id="vg_url" class="ps-modern-input vg-lockable" value="${psEscapeAttr(s.comfyUrl)}" placeholder="http://127.0.0.1:8188" style="flex: 1;" ${lockDisabled} />
                        <button id="vg_test_btn" class="ps-modern-btn secondary vg-lockable" style="padding: 0 15px;" ${lockDisabled}><i class="fa-solid fa-wifi"></i> Test</button>
                    </div>
                    <div style="display:flex; gap: 10px; align-items: center;">
                        <input type="text" id="vg_workflow_path" class="ps-modern-input vg-lockable" value="${psEscapeAttr(workflowPath)}" placeholder="wan-api.json" style="flex: 1;" ${lockDisabled} />
                        <button id="vg_preview_workflow" class="ps-modern-btn secondary vg-lockable" title="Preview patched API JSON" ${lockDisabled}><i class="fa-solid fa-code"></i> Preview</button>
                    </div>
                </div>

                <div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px; ${lockStyle}">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-pen-nib"></i> Prompt Generation</div>
                    <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                        <div style="flex: 1;">
                            <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-main);">Generation Method</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted);">Direct is faster. Preset mode temporarily uses Megumin Image for richer prompt writing.</div>
                        </div>
                        <select id="vg_gen_backend" class="ps-modern-input vg-lockable" style="width: 220px; cursor: pointer;" ${lockDisabled}>
                            <option value="direct" ${s.generatorBackend === 'direct' ? 'selected' : ''}>Direct API Call</option>
                            <option value="preset" ${s.generatorBackend === 'preset' ? 'selected' : ''}>Megumin Image Preset</option>
                        </select>
                    </div>
                    <div class="ps-toggle-card ${s.previewPrompt ? 'active' : ''}" id="vg_preview_card" style="padding: 12px 18px; margin-bottom: 15px;">
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; font-size:0.85rem;">Preview Prompt Before Sending</span>
                            <div style="margin-top:2px; font-size: 0.7rem; color: var(--text-muted);">Review the generated WAN motion prompt before the ComfyUI request starts.</div>
                        </div>
                        <div class="ps-switch"></div>
                    </div>
                    <div id="vg_prompt_builder" style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; border-left: 3px solid var(--gold);">
                        <div style="display: flex; gap: 15px; margin-bottom: 10px;">
                            <div style="flex: 1;">
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Prompt Style</div>
                                <select id="vg_prompt_style" class="ps-modern-input vg-lockable" style="padding: 8px; font-size: 0.8rem;" ${lockDisabled}>
                                    <option value="cinematic" ${s.promptStyle === 'cinematic' ? 'selected' : ''}>Cinematic Prose</option>
                                    <option value="anime" ${s.promptStyle === 'anime' ? 'selected' : ''}>Anime Visual Tags</option>
                                    <option value="realistic" ${s.promptStyle === 'realistic' ? 'selected' : ''}>Realistic Camera</option>
                                </select>
                            </div>
                            <div style="flex: 1;">
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Motion Style</div>
                                <select id="vg_motion_style" class="ps-modern-input vg-lockable" style="padding: 8px; font-size: 0.8rem;" ${lockDisabled}>
                                    <option value="smooth" ${s.motionStyle === 'smooth' ? 'selected' : ''}>Smooth Natural Motion</option>
                                    <option value="subtle" ${s.motionStyle === 'subtle' ? 'selected' : ''}>Subtle Living Still</option>
                                    <option value="dynamic" ${s.motionStyle === 'dynamic' ? 'selected' : ''}>Dynamic Action</option>
                                    <option value="locked" ${s.motionStyle === 'locked' ? 'selected' : ''}>Locked Camera</option>
                                </select>
                            </div>
                        </div>
                        <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Extra Motion / Scene Cues</div>
                        <input type="text" id="vg_extra" class="ps-modern-input vg-lockable" placeholder="camera, gesture, expression change, wind, lighting shift..." value="${psEscapeAttr(s.promptExtra)}" style="padding: 8px; font-size: 0.8rem;" ${lockDisabled} />
                    </div>
                </div>

                <div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-image"></i> Required WAN Inputs</div>
                    <div style="display:flex; gap: 10px; margin-bottom: 15px;">
                        <div style="flex: 1;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">First Frame Image</div>
                            <div style="display:flex; gap: 8px;">
                                <input type="text" id="vg_first_frame" class="ps-modern-input" value="${psEscapeAttr(s.firstFrameImage)}" placeholder="ComfyUI input filename, e.g. start.png" style="padding: 8px; font-size: 0.8rem;" />
                                <button id="vg_upload_first" class="ps-modern-btn secondary" title="Upload image to ComfyUI" style="padding: 0 12px;"><i class="fa-solid fa-upload"></i></button>
                                <button id="vg_gallery_first" class="ps-modern-btn secondary" title="Select from generated image gallery" style="padding: 0 12px;"><i class="fa-solid fa-images"></i></button>
                            </div>
                        </div>
                        <div style="flex: 1;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Last Frame Image</div>
                            <div style="display:flex; gap: 8px;">
                                <input type="text" id="vg_last_frame" class="ps-modern-input" value="${psEscapeAttr(s.lastFrameImage)}" placeholder="Optional end frame filename" style="padding: 8px; font-size: 0.8rem;" />
                                <button id="vg_upload_last" class="ps-modern-btn secondary" title="Upload image to ComfyUI" style="padding: 0 12px;"><i class="fa-solid fa-upload"></i></button>
                                <button id="vg_gallery_last" class="ps-modern-btn secondary" title="Select from generated image gallery" style="padding: 0 12px;"><i class="fa-solid fa-images"></i></button>
                            </div>
                        </div>
                    </div>
                    <input type="file" id="vg_upload_first_file" accept="image/*" style="display:none;" />
                    <input type="file" id="vg_upload_last_file" accept="image/*" style="display:none;" />
                    <div class="ps-toggle-card ${s.useLastFrame ? 'active' : ''}" id="vg_use_last_card" style="padding: 12px 18px; margin-bottom: 15px; ${lockStyle}">
                        <div style="display:flex; flex-direction:column;">
                            <span style="font-weight:600; font-size:0.85rem;">Use First + Last Frame Mode</span>
                            <div style="margin-top:2px; font-size: 0.7rem; color: var(--text-muted);">Routes the WAN workflow through the first/last-frame node when a last image is supplied.</div>
                        </div>
                        <div class="ps-switch"></div>
                    </div>
                    <div style="display:flex; gap: 10px;">
                        <div style="flex: 1;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Negative Prompt</div>
                            <textarea id="vg_negative" class="ps-modern-input vg-lockable" style="height: 95px; resize: vertical; font-size: 0.75rem;" ${lockDisabled}>${negative}</textarea>
                        </div>
                    </div>
                </div>

                <div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px; ${lockStyle}">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-sliders"></i> Video Parameters</div>
                    <div class="vg-param-grid" style="display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 12px; margin-bottom: 15px;">
                        ${vgNumberField("vg_seconds", "Seconds", s.seconds, 1, 60, 1)}
                        ${vgNumberField("vg_fps", "FPS", s.fps, 1, 60, 1)}
                        ${vgNumberField("vg_seed", "Seed (-1 random)", s.customSeed, -1, "", 1)}
                        ${vgNumberField("vg_cfg", "CFG", s.cfg, 0, 30, 0.1)}
                        ${vgNumberField("vg_steps", "Steps Total", s.stepsTotal, 1, 100, 1)}
                        ${vgNumberField("vg_refiner", "Refiner Step", s.refinerStep, 0, 100, 1)}
                        ${vgNumberField("vg_crf", "MP4 CRF", s.crf, 0, 51, 1)}
                        ${vgNumberField("vg_upscale_mult", "Upscale x", s.upscaleMultiplier, 1, 4, 0.5)}
                    </div>
                    <div class="vg-select-grid" style="display: grid; grid-template-columns: repeat(3, minmax(160px, 1fr)); gap: 12px; margin-bottom: 15px;">
                        ${vgSelectField("vg_sampler", "Sampler", s.sampler, ["euler", "euler_ancestral", "heun", "dpm_2", "dpmpp_2m", "dpmpp_sde"])}
                        ${vgSelectField("vg_scheduler", "Scheduler", s.scheduler, ["linear_quadratic", "simple", "normal", "karras", "exponential", "sgm_uniform"])}
                        ${vgSelectField("vg_format", "Output Format", s.outputFormat, ["video/h264-mp4", "image/gif", "video/webm", "video/h265-mp4"])}
                        ${vgSelectField("vg_precision", "Precision", s.precisionPreset, ["0.26 MP - Preview", "0.36 MP - Small", "0.52 MP - SD", "0.65 MP - Balanced", "0.83 MP - HD", "1.05 MP - HD+", "1.20 MP - HD++", "1.35 MP - 2K lite", "1.55 MP - 2K", "1.65 MP - 2K+", "1.75 MP - QHD", "2.10 MP - FHD", "3.30 MP - QHD+", "4.75 MP - 2K Pro", "6.50 MP - Production", "8.30 MP - UHD"])}
                        ${vgSelectField("vg_resolution", "Resolution", s.resolutionPreset, ["480p", "540p", "720p"])}
                        ${vgSelectField("vg_aspect", "Aspect", s.aspectPreset, ["9:16 - Social", "16:9 - Widescreen", "1:1 - Square", "4:3 - Classic", "3:4 - Portrait"])}
                    </div>
                    <div style="display:flex; gap: 10px; margin-bottom: 15px;">
                        <div style="flex: 1;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Output Prefix</div>
                            <input type="text" id="vg_output_prefix" class="ps-modern-input" value="${psEscapeAttr(s.outputPrefix)}" style="padding: 8px; font-size: 0.8rem;" />
                        </div>
                    </div>
                    <div style="display:flex; flex-wrap: wrap; gap: 12px;">
                        <div class="ps-toggle-card ${s.swapAspect ? 'active' : ''}" id="vg_swap_aspect_card" style="padding: 10px 14px; min-width: 190px;"><span style="font-size:0.8rem; font-weight:700;">Swap Aspect</span><div class="ps-switch"></div></div>
                        <div class="ps-toggle-card ${s.enableUpscale ? 'active' : ''}" id="vg_upscale_card" style="padding: 10px 14px; min-width: 190px;"><span style="font-size:0.8rem; font-weight:700;">RTX Upscale</span><div class="ps-switch"></div></div>
                        <div class="ps-toggle-card ${s.enableSmoothLora ? 'active' : ''}" id="vg_smooth_lora_card" style="padding: 10px 14px; min-width: 190px;"><span style="font-size:0.8rem; font-weight:700;">SmoothMix LoRAs</span><div class="ps-switch"></div></div>
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap: 10px; margin-bottom: 20px; flex-wrap: wrap;">
                    <button id="vg_generate_btn" class="ps-modern-btn primary" style="background: var(--gold); color: #000; font-weight: 800;"><i class="fa-solid fa-film"></i> Generate Video</button>
                </div>

                <div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-keyboard"></i> Manual Render</div>
                    <div style="display:flex; gap: 10px; align-items: flex-end; margin-bottom: 12px; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 220px;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">NSFW Position Preset</div>
                            <select id="vg_nsfw_position_preset" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;">
                                ${NSFW_POSITION_PRESETS.map(p => `<option value="${psEscapeAttr(p.prompt)}">${psEscapeText(p.label)}</option>`).join("")}
                            </select>
                        </div>
                        <button id="vg_apply_position_preset" class="ps-modern-btn secondary" style="padding: 8px 12px;"><i class="fa-solid fa-plus"></i> Add Preset</button>
                    </div>
                    <textarea id="vg_manual_prompt" class="ps-modern-input" style="height: 130px; resize: vertical; font-size: 0.85rem; line-height: 1.45; margin-bottom: 12px;" placeholder="Type the exact WAN video prompt to render. This bypasses prompt generation.">${psEscapeText(s.manualPrompt || "")}</textarea>
                    <div style="display:flex; justify-content:flex-end; gap: 10px; flex-wrap: wrap;">
                        <button id="vg_manual_render_btn" class="ps-modern-btn primary" style="background: var(--gold); color: #000; font-weight: 800;"><i class="fa-solid fa-play"></i> Render Manual Prompt</button>
                    </div>
                </div>
            </div>
        `);

        $("#vg_enable_card").on("click", function() {
            s.enabled = !s.enabled;
            saveProfileToMemory();
            if (s.enabled) { $(this).addClass("active").css("border-color", "var(--gold)"); $(this).find("span").css("color", "var(--gold)"); $("#vg_main_content").slideDown(200); }
            else { $(this).removeClass("active").css("border-color", "var(--border-color)"); $(this).find("span").css("color", "var(--text-main)"); $("#vg_main_content").slideUp(200); }
        });
        $("#vg_test_btn").on("click", vgTestConnection);
        $("#vg_preview_workflow").on("click", vgPreviewWorkflowClick);
        $("#vg_generate_btn").on("click", vgManualGenerate);
        $("#vg_manual_render_btn").on("click", vgRenderManualPrompt);
        $("#vg_manual_prompt").on("input", (e) => { s.manualPrompt = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_apply_position_preset").on("click", () => vgApplyPositionPreset(s));
        $("#vg_lock_settings").on("click", function() { s.settingsLocked = !s.settingsLocked; saveProfileToMemory(); renderVideoGen(c); });
        $("#vg_upload_first").on("click", () => $("#vg_upload_first_file").trigger("click"));
        $("#vg_upload_last").on("click", () => $("#vg_upload_last_file").trigger("click"));
        $("#vg_upload_first_file").on("change", (e) => vgUploadFrameFile(e.target.files?.[0], "first"));
        $("#vg_upload_last_file").on("change", (e) => vgUploadFrameFile(e.target.files?.[0], "last"));
        $("#vg_gallery_first").on("click", () => vgOpenGalleryPicker("first"));
        $("#vg_gallery_last").on("click", () => vgOpenGalleryPicker("last"));
        $("#vg_preview_card").on("click", function() { s.previewPrompt = !s.previewPrompt; saveProfileToMemory(); $(this).toggleClass("active", s.previewPrompt); });
        $("#vg_use_last_card").on("click", function() { s.useLastFrame = !s.useLastFrame; saveProfileToMemory(); $(this).toggleClass("active", s.useLastFrame); });
        $("#vg_swap_aspect_card").on("click", function() { s.swapAspect = !s.swapAspect; saveProfileToMemory(); $(this).toggleClass("active", s.swapAspect); });
        $("#vg_upscale_card").on("click", function() { s.enableUpscale = !s.enableUpscale; saveProfileToMemory(); $(this).toggleClass("active", s.enableUpscale); });
        $("#vg_smooth_lora_card").on("click", function() { s.enableSmoothLora = !s.enableSmoothLora; saveProfileToMemory(); $(this).toggleClass("active", s.enableSmoothLora); });

        $("#vg_url").on("input", (e) => { s.comfyUrl = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_workflow_path").on("input", (e) => { s.workflowPath = $(e.target).val() || "wan-api.json"; saveProfileToMemory(); });
        $("#vg_gen_backend").on("change", (e) => { s.generatorBackend = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_prompt_style").on("change", (e) => { s.promptStyle = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_motion_style").on("change", (e) => { s.motionStyle = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_extra").on("input", (e) => { s.promptExtra = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_first_frame").on("input", (e) => { s.firstFrameImage = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_last_frame").on("input", (e) => { s.lastFrameImage = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_negative").on("input", (e) => { s.customNegative = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_output_prefix").on("input", (e) => { s.outputPrefix = $(e.target).val(); saveProfileToMemory(); });

        const bindNum = (id, key, isFloat = false) => {
            $(`#${id}`).on("input", function() {
                const v = isFloat ? parseFloat(this.value) : parseInt(this.value);
                s[key] = isNaN(v) ? s[key] : v;
                saveProfileToMemory();
            });
        };
        bindNum("vg_seconds", "seconds");
        bindNum("vg_fps", "fps");
        bindNum("vg_seed", "customSeed");
        bindNum("vg_cfg", "cfg", true);
        bindNum("vg_steps", "stepsTotal");
        bindNum("vg_refiner", "refinerStep");
        bindNum("vg_crf", "crf");
        bindNum("vg_upscale_mult", "upscaleMultiplier", true);
        $("#vg_sampler").on("change", (e) => { s.sampler = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_scheduler").on("change", (e) => { s.scheduler = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_format").on("change", (e) => { s.outputFormat = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_precision").on("change", (e) => { s.precisionPreset = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_resolution").on("change", (e) => { s.resolutionPreset = $(e.target).val(); saveProfileToMemory(); });
        $("#vg_aspect").on("change", (e) => { s.aspectPreset = $(e.target).val(); saveProfileToMemory(); });
    }

    function vgNumberField(id, label, value, min, max, step) {
        const minAttr = min === "" ? "" : ` min="${min}"`;
        const maxAttr = max === "" ? "" : ` max="${max}"`;
        return `<div><div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">${label}</div><input type="number" id="${id}" class="ps-modern-input" value="${psEscapeAttr(value)}"${minAttr}${maxAttr} step="${step}" style="padding: 8px; font-size: 0.8rem;" /></div>`;
    }

    function vgSelectField(id, label, value, options) {
        return `<div><div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">${label}</div><select id="${id}" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;">${options.map(o => `<option value="${psEscapeAttr(o)}" ${value === o ? "selected" : ""}>${psEscapeText(o)}</option>`).join("")}</select></div>`;
    }

    function liTagFieldToggle(id, label, enabled) {
        return `
            <div id="${id}" class="ps-toggle-card ${enabled ? 'active' : ''}" style="padding: 8px 10px; min-height: auto; cursor: pointer; border-color: ${enabled ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'};">
                <span style="font-size: 0.7rem; font-weight: 800; color: ${enabled ? '#10b981' : 'var(--text-muted)'};">${label}</span>
                <div class="ps-switch" style="transform: scale(0.65);"></div>
            </div>
        `;
    }

    function appendPromptTextToTextarea(textareaSelector, snippet) {
        const prompt = String(snippet || "").trim();
        if (!prompt) return "";
        const textarea = $(textareaSelector);
        const current = String(textarea.val() || "").trim();
        const next = current ? `${current}, ${prompt}` : prompt;
        textarea.val(next);
        return next;
    }

    function applyPromptPresetToTextarea(selectSelector, textareaSelector, settingsObj, fieldName) {
        const next = appendPromptTextToTextarea(textareaSelector, $(selectSelector).val());
        if (!next) return;
        settingsObj[fieldName] = next;
        saveProfileToMemory();
        toastr.success("Preset added to manual prompt.");
    }

    function vgApplyPositionPreset(s) {
        applyPromptPresetToTextarea("#vg_nsfw_position_preset", "#vg_manual_prompt", s, "manualPrompt");
    }

    // -------------------------------------------------------------
    // STAGE 8 HELPER FUNCTIONS
    // -------------------------------------------------------------
    let meguminComfyLoraCache = null;
    let meguminComfyLoraCacheUrl = "";

    /** Map saved LoRA path to the exact string Comfy lists (folder slash vs backslash, etc.). */
    function resolveLoraPathForDropdown(stored, filesList) {
        if (!stored || stored === "None" || stored === "") return stored || "";
        if (!filesList || !filesList.length) return stored;
        if (filesList.includes(stored)) return stored;
        const norm = (p) => String(p).replace(/\\/g, "/").trim().toLowerCase();
        const n = norm(stored);
        for (const f of filesList) {
            if (norm(f) === n) return f;
        }
        const base = stored.replace(/^.*[/\\]/, "");
        if (base) {
            const nb = base.trim().toLowerCase();
            for (const f of filesList) {
                const tail = f.replace(/^.*[/\\]/, "");
                if (tail.trim().toLowerCase() === nb) return f;
            }
        }
        return stored;
    }

    async function ensureMeguminComfyLoraList(s) {
        if (ensureRunpodSettings(s).enabled) return RUNPOD_IMAGE_LORAS;
        const url = (s && s.comfyUrl) ? String(s.comfyUrl).trim() : "";
        if (!url) return [];
        if (meguminComfyLoraCache && meguminComfyLoraCacheUrl === url) return meguminComfyLoraCache;
        try {
            const lRes = await fetch(`${url}/object_info/LoraLoader`);
            if (lRes.ok) {
                const json = await lRes.json();
                meguminComfyLoraCache = json["LoraLoader"].input.required.lora_name[0] || [];
                meguminComfyLoraCacheUrl = url;
                return meguminComfyLoraCache;
            }
        } catch (e) {}
        return [];
    }

    async function igFetchComfyLists() {
        const s = getLocalProfile().imageGen;
        if (ensureRunpodSettings(s).enabled) {
            if (ensureRunpodDropdownValues(s)) saveProfileToMemory();
            populateRunpodImageLists(s);
            meguminComfyLoraCache = RUNPOD_IMAGE_LORAS;
            meguminComfyLoraCacheUrl = "runpod";
            return;
        }
        const url = s.comfyUrl;
        try {
            const mRes = await fetch('/api/sd/comfy/models', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: url }) });
            if (mRes.ok) {
                const models = await mRes.json();
                const sel = $("#ig_model"); sel.empty().append('<option value="">-- Select Model --</option>');
                models.forEach(m => { let v = m.value || m; let t = m.text || v; sel.append(`<option value="${v}">${t}</option>`); });
                if (s.selectedModel) sel.val(s.selectedModel);
            }
            const sRes = await fetch('/api/sd/comfy/samplers', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: url }) });
            if (sRes.ok) {
                const samplers = await sRes.json();
                const sel = $("#ig_sampler"); sel.empty();
                samplers.forEach(sa => sel.append(`<option value="${sa}">${sa}</option>`));
                if (s.selectedSampler) sel.val(s.selectedSampler);
            }
            ensureSelectHasOptions($("#ig_scheduler"), RUNPOD_IMAGE_SCHEDULERS, s.selectedScheduler);
            const ksRes = await fetch(`${url}/object_info/KSampler`);
            if (ksRes.ok) {
                const json = await ksRes.json();
                const schedulers = json?.KSampler?.input?.required?.scheduler?.[0] || [];
                ensureSelectHasOptions($("#ig_scheduler"), schedulers, s.selectedScheduler);
            }
            const lRes = await fetch(`${url}/object_info/LoraLoader`);
            if (lRes.ok) {
                const json = await lRes.json();
                const files = json["LoraLoader"].input.required.lora_name[0] || [];
                meguminComfyLoraCache = files;
                meguminComfyLoraCacheUrl = url;
                let canonChanged = false;
                for (let i = 1; i <= 4; i++) {
                    const sel = $(`#ig_lora_${i}`);
                    const key = i === 1 ? "selectedLora" : `selectedLora${i}`;
                    const val = s[key];
                    sel.empty().append('<option value="">-- No LoRA --</option>');
                    files.forEach(f => { sel.append($("<option></option>").attr("value", f).text(f)); });
                    if (val) {
                        const resolved = resolveLoraPathForDropdown(val, files);
                        if (resolved && resolved !== val) {
                            s[key] = resolved;
                            canonChanged = true;
                        }
                        sel.val(resolved || val);
                    }
                }
                if (canonChanged) saveProfileToMemory();
            }
        } catch (e) { console.warn(`[Megumin-Suite] ComfyLists failed`, e); }
    }

    // -------------------------------------------------------------
    // LORA INTELLIGENCE HELPERS
    // -------------------------------------------------------------
    /** Last POST body sent to ComfyUI `/prompt` (session memory; refreshed on each generation). */
    let igLastComfyApiRequest = null;

    /** Replace Megumin %placeholders% in workflow node inputs (strings only). Recurses into plain objects so nested widgets (e.g. rgthree Power Lora Loader `lora_N: { lora, strength }`) are patched; arrays are left as-is (Comfy links). */
    function igSubstituteComfyPlaceholderDeep(val, repl, seedPlaceholderState) {
        if (typeof val === "string" && Object.prototype.hasOwnProperty.call(repl, val)) {
            if (val === "%seed%" && seedPlaceholderState) seedPlaceholderState.injected = true;
            return repl[val];
        }
        if (!val || typeof val !== "object" || Array.isArray(val)) return val;
        for (const k of Object.keys(val)) {
            val[k] = igSubstituteComfyPlaceholderDeep(val[k], repl, seedPlaceholderState);
        }
        return val;
    }

    function igWorkflowContainsPlaceholder(value, placeholder) {
        if (typeof value === "string") return value === placeholder;
        if (!value || typeof value !== "object") return false;
        if (Array.isArray(value)) return value.some(item => igWorkflowContainsPlaceholder(item, placeholder));
        return Object.values(value).some(item => igWorkflowContainsPlaceholder(item, placeholder));
    }

    function igExtractComfyGeneratedPrompt(historyEntry, workflow) {
        const outputs = historyEntry?.outputs;
        if (!outputs || typeof outputs !== "object") return "";
        const nanoNodeIds = Object.entries(workflow || {})
            .filter(([, node]) => node?.class_type === "MeguminNanoGPTText")
            .map(([nodeId]) => String(nodeId));
        for (const nodeId of nanoNodeIds) {
            const nodeOutput = outputs[nodeId];
            if (!nodeOutput || typeof nodeOutput !== "object") continue;
            const candidates = [
                nodeOutput.text,
                nodeOutput.generated_text,
                nodeOutput.prompt,
                nodeOutput.result
            ];
            for (const candidate of candidates) {
                const value = Array.isArray(candidate) ? candidate[0] : candidate;
                if (typeof value === "string" && value.trim()) return stripUtilityThinkingWrapper(value);
            }
        }
        return "";
    }

    function igCollectWorkflowLoraNodes(workflow) {
        const out = [];
        if (!workflow || typeof workflow !== "object") return out;
        for (const nodeId of Object.keys(workflow)) {
            const node = workflow[nodeId];
            if (!node || !node.inputs) continue;
            if (!Object.prototype.hasOwnProperty.call(node.inputs, "lora_name")) continue;
            const inp = node.inputs;
            out.push({
                node_id: nodeId,
                class_type: node.class_type || "?",
                lora_name: inp.lora_name,
                strength_model: inp.strength_model,
                strength_clip: inp.strength_clip
            });
        }
        return out;
    }

    function igCollectWorkflowSamplerNodes(workflow) {
        const out = [];
        if (!workflow || typeof workflow !== "object") return out;
        for (const nodeId of Object.keys(workflow)) {
            const node = workflow[nodeId];
            if (!node || !node.inputs) continue;
            const inp = node.inputs;
            if (inp.sampler_name === undefined && inp.scheduler === undefined) continue;
            const row = { node_id: nodeId, class_type: node.class_type || "?" };
            if (inp.sampler_name !== undefined) row.sampler_name = inp.sampler_name;
            if (inp.scheduler !== undefined) row.scheduler = inp.scheduler;
            if (inp.steps !== undefined) row.steps = inp.steps;
            if (inp.cfg !== undefined) row.cfg = inp.cfg;
            if (inp.seed !== undefined) row.seed = inp.seed;
            if (inp.denoise !== undefined) row.denoise = inp.denoise;
            out.push(row);
        }
        return out;
    }

    function igBuildLastComfyApiSnapshot(s, workflow, finalPrompt, aiText, finalSeed, l1, l2, l3, l4, w1, w2, w3, w4) {
        const fullPayload = { prompt: JSON.parse(JSON.stringify(workflow)) };
        const cs = parseInt(s.clipSkip, 10);
        return {
            at: new Date().toISOString(),
            comfy_url: s.comfyUrl,
            workflow_file: s.currentWorkflowName,
            positive_prompt: finalPrompt,
            ai_text: aiText,
            negative_prompt: s.customNegative || "",
            final_seed: finalSeed,
            megumin: {
                model: s.selectedModel || "",
                sampler: s.selectedSampler || "",
                scheduler: s.selectedScheduler || "",
                steps: parseInt(s.steps, 10) || 20,
                cfg: parseFloat(s.cfg) || 7,
                denoise: parseFloat(s.denoise) || 1,
                clip_skip_ui: s.clipSkip,
                clip_skip_injected: -Math.abs(cs) || -1,
                width: parseInt(s.imgWidth, 10) || 512,
                height: parseInt(s.imgHeight, 10) || 512
            },
            lora_slots: [
                { slot: 1, file: l1 || "None", weight: w1 },
                { slot: 2, file: l2 || "None", weight: w2 },
                { slot: 3, file: l3 || "None", weight: w3 },
                { slot: 4, file: l4 || "None", weight: w4 }
            ],
            workflow_lora_nodes: igCollectWorkflowLoraNodes(workflow),
            workflow_sampler_nodes: igCollectWorkflowSamplerNodes(workflow),
            full_payload: fullPayload
        };
    }

    function igFormatLastComfyApiSummary(snap) {
        if (!snap) return "No ComfyUI request sent yet in this session.";
        const lines = [];
        lines.push(`Time: ${snap.at}`);
        lines.push(`POST ${snap.comfy_url}/prompt`);
        lines.push(`Workflow file: ${snap.workflow_file}`);
        lines.push("");
        lines.push("── Positive prompt ──");
        lines.push(String(snap.positive_prompt || "(empty)"));
        lines.push("");
        lines.push("── Negative prompt ──");
        lines.push(String(snap.negative_prompt || "(empty)"));
        lines.push("");
        lines.push("── Megumin placeholder values ──");
        lines.push(`Seed: ${snap.final_seed}`);
        const m = snap.megumin;
        lines.push(`Checkpoint (%model%): ${m.model || "(empty)"}`);
        lines.push(`Sampler (%sampler%): ${m.sampler || "(empty)"}`);
        lines.push(`Scheduler (%scheduler%): ${m.scheduler || "(empty)"}`);
        lines.push(`Steps / CFG / Denoise: ${m.steps} / ${m.cfg} / ${m.denoise}`);
        lines.push(`CLIP skip (UI → injected as %clip_skip%): ${m.clip_skip_ui} → ${m.clip_skip_injected}`);
        lines.push(`Size (%width% × %height%): ${m.width} × ${m.height}`);
        lines.push("");
        lines.push("── LoRA slots (after LoRA Intelligence / UI resolve) ──");
        snap.lora_slots.forEach((l) => {
            const f = l.file && l.file !== "None" ? l.file : "None";
            lines.push(`  Slot ${l.slot}: ${f}  weight ${l.weight}`);
        });
        lines.push("");
        lines.push("── LoRA loader nodes in graph (resolved) ──");
        if (!snap.workflow_lora_nodes.length) lines.push("  (none detected)");
        else {
            snap.workflow_lora_nodes.forEach((n) => {
                lines.push(`  [${n.node_id}] ${n.class_type}: ${JSON.stringify(n.lora_name)}  model ${n.strength_model}  clip ${n.strength_clip}`);
            });
        }
        lines.push("");
        lines.push("── Sampler / scheduler fields in graph ──");
        if (!snap.workflow_sampler_nodes.length) lines.push("  (none detected — workflow may use different node types)");
        else {
            snap.workflow_sampler_nodes.forEach((n) => {
                const bits = [`[${n.node_id}] ${n.class_type}`];
                if (n.sampler_name !== undefined) bits.push(`sampler_name=${JSON.stringify(n.sampler_name)}`);
                if (n.scheduler !== undefined) bits.push(`scheduler=${JSON.stringify(n.scheduler)}`);
                if (n.steps !== undefined) bits.push(`steps=${n.steps}`);
                if (n.cfg !== undefined) bits.push(`cfg=${n.cfg}`);
                if (n.seed !== undefined) bits.push(`seed=${n.seed}`);
                if (n.denoise !== undefined) bits.push(`denoise=${n.denoise}`);
                lines.push(`  ${bits.join("  ")}`);
            });
        }
        lines.push("");
        lines.push("── Tip ──");
        lines.push('Switch "View" to "Full JSON" for the exact payload sent to ComfyUI.');
        return lines.join("\n");
    }

    function igRefreshLastComfyApiPanel() {
        const $fmt = $("#li_last_comfy_req_view");
        const $ta = $("#li_last_comfy_req_body");
        if (!$fmt.length || !$ta.length) return;
        const mode = $fmt.val() || "summary";
        if (mode === "json") {
            $ta.val(igLastComfyApiRequest ? JSON.stringify(igLastComfyApiRequest.full_payload, null, 2) : igFormatLastComfyApiSummary(null));
        } else {
            $ta.val(igFormatLastComfyApiSummary(igLastComfyApiRequest));
        }
    }

    let cachedLoraFiles = null;

    function liPruneMissingActiveLoras(li, availableFiles) {
        if (!li || !Array.isArray(availableFiles)) return 0;
        const available = new Set(availableFiles.map(normalizeLoraKeyForDedupe));
        const isAvailable = (entry) => {
            const resolved = resolveLoraPathForDropdown(entry?.name, availableFiles);
            return !!resolved && available.has(normalizeLoraKeyForDedupe(resolved));
        };
        let removed = 0;
        const prune = (list) => {
            if (!Array.isArray(list)) return [];
            return list.filter(entry => {
                const keep = isAvailable(entry);
                if (!keep) removed++;
                return keep;
            });
        };

        li.globalActiveLoras = prune(li.globalActiveLoras);
        for (const key of Object.keys(li.characterActiveLoras || {})) {
            li.characterActiveLoras[key] = prune(li.characterActiveLoras[key]);
        }
        return removed;
    }

    async function liPopulateLoraList(s, li, charKey, forceRefresh = false) {
        const container = $("#li_lora_list");

        // Remember open folders
        const openFolders = [];
        container.find(".li-folder").each(function() {
            if ($(this).find(".li-folder-body").is(":visible")) {
                openFolders.push($(this).find(".li-folder-header span").first().text());
            }
        });

        if (forceRefresh || !cachedLoraFiles) {
            if (!cachedLoraFiles) container.empty();
            try {
                const lRes = await fetch(`${s.comfyUrl}/object_info/LoraLoader`);
                if (lRes.ok) {
                    const json = await lRes.json();
                    cachedLoraFiles = json['LoraLoader'].input.required.lora_name[0] || [];
                } else return false;
            } catch (e) {
                container.html('<div style="text-align: center; color: #ef4444; font-size: 0.8rem; padding: 15px;">Failed to fetch LoRAs from ComfyUI.</div>');
                return false;
            }
        }

        container.empty();
        let loraFiles = cachedLoraFiles || [];
        const removedStaleLoras = liPruneMissingActiveLoras(li, loraFiles);
        if (removedStaleLoras > 0) saveProfileToMemory();

        if (loraFiles.length === 0) {
            container.html('<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 15px;">No LoRAs found in ComfyUI.</div>');
            return true;
        }

        const scope = $("#li_scope_select").val() || "global";
        let activeList = scope === "character" && li.characterActiveLoras[charKey] ? li.characterActiveLoras[charKey] : li.globalActiveLoras;

        // Build a lookup map of active LoRAs
        const activeMap = new Map();
        activeList.forEach(l => activeMap.set(l.name, l));

        // Group LoRAs by folder
        const folders = {};
        const rootFiles = [];
        loraFiles.forEach(f => {
            const sep = f.lastIndexOf('/') !== -1 ? f.lastIndexOf('/') : f.lastIndexOf('\\');
            if (sep > 0) {
                const folder = f.substring(0, sep);
                if (!folders[folder]) folders[folder] = [];
                folders[folder].push(f);
            } else {
                rootFiles.push(f);
            }
        });

        const renderLoraItem = (f) => {
            const existing = activeMap.get(f);
            const isActive = existing ? existing.enabled : false;
            const identityKeywords = getVrtlLoraIdentityKeywords(f);
            if (existing && identityKeywords) existing.keywords = identityKeywords;
            const effectiveKeywords = existing ? getEffectiveLoraKeywords(existing) : [];
            const keywordsStr = effectiveKeywords.join(', ');
            const shortName = f.includes('/') ? f.split('/').pop() : (f.includes('\\') ? f.split('\\').pop() : f);

            const item = $(`
                <div class="li-lora-item" style="display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; background: ${isActive ? 'rgba(168,85,247,0.1)' : 'rgba(0,0,0,0.15)'}; border: 1px solid ${isActive ? 'rgba(168,85,247,0.3)' : 'var(--border-color)'}; border-radius: 6px; cursor: pointer; transition: 0.2s;" data-lora="${f}">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 18px; height: 18px; border-radius: 4px; border: 2px solid ${isActive ? '#a855f7' : '#52525b'}; background: ${isActive ? '#a855f7' : 'transparent'}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            ${isActive ? '<i class="fa-solid fa-check" style="font-size: 0.55rem; color: #fff;"></i>' : ''}
                        </div>
                        <div style="flex: 1; min-width: 0; font-size: 0.75rem; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${f}">${shortName}</div>
                    </div>
                    ${isActive ? `
                    <div style="display: flex; align-items: center; gap: 6px; padding-left: 28px;">
                        <i class="fa-solid fa-key" style="color: #a855f7; font-size: 0.65rem;"></i>
                        <input type="text" class="ps-modern-input li-lora-kw-input" value="${keywordsStr.replace(/"/g, '&quot;')}" placeholder="Activation words (e.g. a woman)" style="font-size: 0.65rem; padding: 2px 6px; height: 20px; flex: 1; background: rgba(0,0,0,0.2); color: #a855f7; border-color: rgba(168,85,247,0.3);" />
                    </div>
                    ` : ''}
                </div>
            `);

            item.on("click", function(e) {
                if ($(e.target).is("input")) return;
                const loraName = $(this).attr("data-lora");
                const existingEntry = activeList.find(l => l.name === loraName);
                if (existingEntry) {
                    existingEntry.enabled = !existingEntry.enabled;
                    const identityKeywords = getVrtlLoraIdentityKeywords(loraName);
                    if (identityKeywords) existingEntry.keywords = identityKeywords;
                } else {
                    const defaultKws = getDefaultLoraKeywords(loraName);
                    activeList.push({ name: loraName, enabled: true, keywords: defaultKws });
                }

                if (scope === "character") li.characterActiveLoras[charKey] = activeList;
                else li.globalActiveLoras = activeList;
                saveProfileToMemory();
                liPopulateLoraList(s, li, charKey);
            });

            if (isActive) {
                item.find(".li-lora-kw-input").on("input", function() {
                    const existingEntry = activeList.find(l => l.name === f);
                    if (existingEntry) {
                        existingEntry.keywords = getVrtlLoraIdentityKeywords(f)
                            || $(this).val().split(',').map(s => s.trim()).filter(s => s);
                        saveProfileToMemory();
                    }
                });
            }

            return item;
        };

        // Render folders
        const folderNames = Object.keys(folders).sort();
        folderNames.forEach(folder => {
            const folderEl = $(`
                <div class="li-folder" style="margin-bottom: 4px;">
                    <div class="li-folder-header" style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: rgba(168,85,247,0.05); border: 1px solid rgba(168,85,247,0.15); border-radius: 6px; cursor: pointer; user-select: none;">
                        <i class="fa-solid fa-folder" style="color: #a855f7; font-size: 0.75rem;"></i>
                        <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-main); flex: 1;">${folder}</span>
                        <span style="font-size: 0.6rem; color: var(--text-muted);">${folders[folder].length} LoRAs</span>
                        <i class="fa-solid fa-chevron-right li-folder-chevron" style="font-size: 0.6rem; color: var(--text-muted); transition: transform 0.2s;"></i>
                    </div>
                    <div class="li-folder-body" style="display: none; padding-left: 15px; padding-top: 4px; display: flex; flex-direction: column; gap: 3px;"></div>
                </div>
            `);

            const body = folderEl.find(".li-folder-body");
            if (openFolders.includes(folder)) {
                body.show();
                folderEl.find(".li-folder-chevron").css("transform", "rotate(90deg)");
            } else {
                body.hide();
            }

            folderEl.find(".li-folder-header").on("click", function() {
                body.slideToggle(150);
                $(this).find(".li-folder-chevron").css("transform", body.is(":visible") ? "rotate(90deg)" : "rotate(0deg)");
            });

            folders[folder].forEach(f => body.append(renderLoraItem(f)));
            container.append(folderEl);
        });

        // Render root files
        rootFiles.forEach(f => container.append(renderLoraItem(f)));
        return true;
    }

    function liRenderAssignmentTable(li, charKey, s) {
        const table = $("#li_assignment_table");
        table.empty();
        syncCurrentModeCharacterAssignments(li, charKey);

        if (!li.ensureLoras && !li.useCharDescriptions && !li.useDanbooruTags) {
            table.hide();
            return;
        } else {
            table.show();
        }

        const assignments = getModeCharacterAssignments(li, charKey);

        const showLoras = li.ensureLoras;
        const showDesc = li.useCharDescriptions;
        const showBooru = li.useDanbooruTags;
        const showMatchKw = showLoras || showBooru;

        let gridCols = "1fr ";
        if (showMatchKw) gridCols += "1.5fr ";
        if (showLoras) gridCols += "1.5fr ";
        if (showBooru) gridCols += "2fr ";
        if (showDesc) gridCols += "2fr ";

        let headerHtml = `<div style="display: grid; grid-template-columns: ${gridCols}; gap: 8px; flex: 1;">
            <span style="font-size: 0.65rem; font-weight: 800; color: var(--gold); text-transform: uppercase;">Character</span>`;
        if (showMatchKw) {
            headerHtml += `<span style="font-size: 0.65rem; font-weight: 800; color: var(--gold); text-transform: uppercase;">Match Keywords</span>`;
        }
        if (showLoras) {
            headerHtml += `<span style="font-size: 0.65rem; font-weight: 800; color: var(--gold); text-transform: uppercase;">LoRA File</span>`;
        }
        if (showBooru) {
            headerHtml += `<span style="font-size: 0.65rem; font-weight: 800; color: #10b981; text-transform: uppercase; font-size: 0.65rem; font-weight: 800;">Booru Tags</span>`;
        }
        if (showDesc) {
            headerHtml += `<span style="font-size: 0.65rem; font-weight: 800; color: var(--gold); text-transform: uppercase;">Description</span>`;
        }
        headerHtml += `</div>`;

        const header = $(`
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(245,158,11,0.1); border-radius: 6px; margin-bottom: 6px;">
                ${headerHtml}
                <span style="font-size:0.62rem; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-left:10px;">${psEscapeText(getAssignmentModeLabel(li))}</span>
                <button id="li_add_custom_assign" class="ps-modern-btn primary" style="padding: 2px 8px; font-size: 0.65rem; margin-left: 10px; background: var(--gold); color: #000;"><i class="fa-solid fa-plus"></i> Add</button>
            </div>
        `);

        header.find("#li_add_custom_assign").on("click", function() {
            assignments.push(ensureStructuredCharacterAssignment({ character: "", match_keywords: "", lora: "", description: "", plain_description: "", booru_tags: "", character_tag: "", series_tag: "", physical_tags: "", clothing_tags: "", alwaysInclude: false, neverInclude: false }));
            setModeCharacterAssignments(li, charKey, assignments);
            saveProfileToMemory();
            liRenderAssignmentTable(li, charKey, s);
        });

        table.append(header);

        if (assignments.length === 0) {
            table.append('<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 15px; border: 1px dashed var(--border-color); border-radius: 8px;">No assignments yet. Click "Analyze Characters" or "Add".</div>');
            return;
        }

        assignments.forEach((a, idx) => {
            ensureStructuredCharacterAssignment(a);

            if (showBooru) {
                const rowToggle = (key, label) => {
                    const enabled = a.tagFieldToggles?.[key] !== false;
                    return `<button type="button" class="ps-modern-btn secondary li-row-field-toggle ${enabled ? 'active' : ''}" data-field="${key}" title="Include ${label} for this character" style="padding: 4px 7px; font-size: 0.62rem; min-width: auto; border-color: ${enabled ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'}; color: ${enabled ? '#10b981' : 'var(--text-muted)'};">${label}</button>`;
                };
                const tagField = (key, label, placeholder) => `
                    <label style="display: flex; flex-direction: column; gap: 4px; min-width: 0;">
                        <span style="font-size: 0.62rem; font-weight: 800; color: #10b981; text-transform: uppercase;">${label}</span>
                        <input class="ps-modern-input li-edit-tag-field" data-key="${key}" type="text" placeholder="${psEscapeAttr(placeholder)}" value="${psEscapeAttr(a[key] || '')}" style="font-size: 0.68rem; color: #10b981; padding: 6px; min-width: 0;" />
                    </label>
                `;

                if (li.assignmentViewMode === 'plain') {
                    const plainValue = a.plain_description || getAssignmentTagBlock(a, li) || a.description || "";
                    const row = $(`
                        <div style="display: flex; flex-direction: column; gap: 10px; padding: 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 8px;">
                            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                                <input class="ps-modern-input li-edit-char" type="text" placeholder="Character" value="${psEscapeAttr(a.character || '')}" style="flex: 1; min-width: 120px; font-size: 0.78rem; font-weight: 700; padding: 6px;" />
                                ${showMatchKw ? `<input class="ps-modern-input li-edit-match" type="text" placeholder="Match keywords" value="${psEscapeAttr(a.match_keywords || '')}" style="flex: 1.3; min-width: 140px; font-size: 0.68rem; color: var(--text-muted); padding: 6px;" />` : ''}
                                <button type="button" class="ps-modern-btn secondary li-always-include ${a.alwaysInclude ? 'active' : ''}" title="Always include this character even when match keywords are absent from recent chat" style="padding: 5px 8px; font-size: 0.65rem; color: ${a.alwaysInclude ? '#10b981' : 'var(--text-muted)'}; border-color: ${a.alwaysInclude ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-thumbtack"></i> Always</button>
                                <button type="button" class="ps-modern-btn secondary li-never-include ${a.neverInclude ? 'active' : ''}" title="Never include this character in prompts, LoRAs, or manual tag insertion" style="padding: 5px 8px; font-size: 0.65rem; color: ${a.neverInclude ? '#ef4444' : 'var(--text-muted)'}; border-color: ${a.neverInclude ? 'rgba(239,68,68,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-ban"></i> Never</button>
                                <button class="ps-modern-btn secondary li-remove-assign" data-idx="${idx}" style="padding: 5px 8px; font-size: 0.65rem; color: #ef4444; border-color: rgba(239,68,68,0.3);"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                            ${showLoras ? `<input class="ps-modern-input li-edit-lora" type="text" placeholder="LoRA file" value="${psEscapeAttr(a.lora || '')}" style="font-size: 0.7rem; color: #a855f7; padding: 6px;" />` : ''}
                            <textarea class="ps-modern-input li-edit-plain-desc" placeholder="Plain natural-language or tag-style character description. Used when Plain Text View is active." style="height: 84px; resize: vertical; font-size: 0.72rem; color: #10b981; padding: 8px;">${psEscapeText(plainValue)}</textarea>
                        </div>
                    `);

                    row.find(".li-edit-char").on("input", function() { a.character = $(this).val(); saveProfileToMemory(); });
                    if (showMatchKw) row.find(".li-edit-match").on("input", function() { a.match_keywords = $(this).val(); saveProfileToMemory(); });
                    if (showLoras) row.find(".li-edit-lora").on("input", function() { a.lora = $(this).val(); saveProfileToMemory(); });
                    row.find(".li-edit-plain-desc").on("input", function() { a.plain_description = $(this).val(); saveProfileToMemory(); });
                    row.find(".li-always-include").on("click", function() { a.alwaysInclude = !a.alwaysInclude; if (a.alwaysInclude) a.neverInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });
                    row.find(".li-never-include").on("click", function() { a.neverInclude = !a.neverInclude; if (a.neverInclude) a.alwaysInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });
                    row.find(".li-remove-assign").on("click", function() {
                        assignments.splice(idx, 1);
                        setModeCharacterAssignments(li, charKey, assignments);
                        saveProfileToMemory();
                        liRenderAssignmentTable(li, charKey, s);
                    });
                    table.append(row);
                    return;
                }

                const row = $(`
                    <div style="display: flex; flex-direction: column; gap: 10px; padding: 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 8px;">
                        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                            <input class="ps-modern-input li-edit-char" type="text" placeholder="Character" value="${psEscapeAttr(a.character || '')}" style="flex: 1; min-width: 120px; font-size: 0.78rem; font-weight: 700; padding: 6px;" />
                            ${showMatchKw ? `<input class="ps-modern-input li-edit-match" type="text" placeholder="Match keywords" value="${psEscapeAttr(a.match_keywords || '')}" style="flex: 1.3; min-width: 140px; font-size: 0.68rem; color: var(--text-muted); padding: 6px;" />` : ''}
                            <button type="button" class="ps-modern-btn secondary li-always-include ${a.alwaysInclude ? 'active' : ''}" title="Always include this character even when match keywords are absent from recent chat" style="padding: 5px 8px; font-size: 0.65rem; color: ${a.alwaysInclude ? '#10b981' : 'var(--text-muted)'}; border-color: ${a.alwaysInclude ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-thumbtack"></i> Always</button>
                            <button type="button" class="ps-modern-btn secondary li-never-include ${a.neverInclude ? 'active' : ''}" title="Never include this character in prompts, LoRAs, or manual tag insertion" style="padding: 5px 8px; font-size: 0.65rem; color: ${a.neverInclude ? '#ef4444' : 'var(--text-muted)'}; border-color: ${a.neverInclude ? 'rgba(239,68,68,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-ban"></i> Never</button>
                            <button class="ps-modern-btn secondary li-remove-assign" data-idx="${idx}" style="padding: 5px 8px; font-size: 0.65rem; color: #ef4444; border-color: rgba(239,68,68,0.3);"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                        ${showLoras ? `<input class="ps-modern-input li-edit-lora" type="text" placeholder="LoRA file" value="${psEscapeAttr(a.lora || '')}" style="font-size: 0.7rem; color: #a855f7; padding: 6px;" />` : ''}
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span style="font-size: 0.62rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Include</span>
                            ${getTagFieldToggleDefaults().map(t => rowToggle(t.key, t.label)).join("")}
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px;">
                            ${tagField('character_tag', 'Character Tag', 'saber \\(fate\\)')}
                            ${tagField('series_tag', 'Series Tag', 'fate \\(series\\)')}
                            ${tagField('physical_tags', 'Body / Face', 'blonde hair, blue eyes')}
                            ${tagField('clothing_tags', 'Clothing', 'black jacket, dark jeans')}
                        </div>
                        ${showDesc ? `<input class="ps-modern-input li-edit-desc" type="text" placeholder="Physical description..." value="${psEscapeAttr(a.description || '')}" style="font-size: 0.68rem; color: #3b82f6; padding: 6px;" />` : ''}
                    </div>
                `);

                row.find(".li-edit-char").on("input", function() { a.character = $(this).val(); saveProfileToMemory(); });
                if (showMatchKw) row.find(".li-edit-match").on("input", function() { a.match_keywords = $(this).val(); saveProfileToMemory(); });
                if (showLoras) row.find(".li-edit-lora").on("input", function() { a.lora = $(this).val(); saveProfileToMemory(); });
                if (showDesc) row.find(".li-edit-desc").on("input", function() { a.description = $(this).val(); saveProfileToMemory(); });
                row.find(".li-always-include").on("click", function() { a.alwaysInclude = !a.alwaysInclude; if (a.alwaysInclude) a.neverInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });
                row.find(".li-never-include").on("click", function() { a.neverInclude = !a.neverInclude; if (a.neverInclude) a.alwaysInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });
                row.find(".li-row-field-toggle").on("click", function() {
                    const key = $(this).attr("data-field");
                    ensureStructuredCharacterAssignment(a);
                    a.tagFieldToggles[key] = !a.tagFieldToggles[key];
                    saveProfileToMemory();
                    liRenderAssignmentTable(li, charKey, s);
                });
                row.find(".li-edit-tag-field").on("input", function() {
                    a[$(this).attr("data-key")] = $(this).val();
                    a.booru_tags = [
                        a.character_tag,
                        a.series_tag,
                        a.physical_tags,
                        a.clothing_tags
                    ].filter(Boolean).join(', ');
                    saveProfileToMemory();
                });
                row.find(".li-edit-tag-field").on("blur", function() {
                    const key = $(this).attr("data-key");
                    let value = a[key] || "";
                    if (value && danbooruTagsMap && danbooruTagsMap.size > 0) value = repairBooruTags(value);
                    a[key] = normalizeGeneratedTagField(value);
                    normalizeStructuredCharacterAssignment(a);
                    $(this).val(a[key]);
                    saveProfileToMemory();
                });
                row.find(".li-remove-assign").on("click", function() {
                    assignments.splice(idx, 1);
                    setModeCharacterAssignments(li, charKey, assignments);
                    saveProfileToMemory();
                    liRenderAssignmentTable(li, charKey, s);
                });
                table.append(row);
                return;
            }

            let rowHtml = `<div style="display: grid; grid-template-columns: ${gridCols}; gap: 8px; flex: 1;">
                <input class="ps-modern-input li-edit-char" type="text" placeholder="Character" value="${a.character ? a.character.replace(/"/g, '&quot;') : ''}" style="font-size: 0.75rem; font-weight: 600; padding: 4px; border: 1px solid transparent; background: transparent; color: var(--text-main);" />`;
            if (showMatchKw) {
                rowHtml += `<input class="ps-modern-input li-edit-match" type="text" placeholder="Match (e.g. Megumin, Megu)" value="${a.match_keywords ? a.match_keywords.replace(/"/g, '&quot;') : ''}" style="font-size: 0.65rem; color: var(--text-muted); padding: 4px; border: 1px solid transparent; background: transparent;" />`;
            }
            if (showLoras) {
                rowHtml += `<input class="ps-modern-input li-edit-lora" type="text" placeholder="LoRA File" value="${a.lora ? a.lora.replace(/"/g, '&quot;') : ''}" style="font-size: 0.7rem; color: #a855f7; padding: 4px; border: 1px solid transparent; background: transparent;" />`;
            }
            if (showBooru) {
                rowHtml += `<input class="ps-modern-input li-edit-booru" type="text" placeholder="e.g. blue_eyes, long_hair, 1girl" value="${a.booru_tags ? a.booru_tags.replace(/"/g, '&quot;') : ''}" style="font-size: 0.65rem; color: #10b981; padding: 4px; border: 1px solid transparent; background: transparent;" />`;
            }
            if (showDesc) {
                rowHtml += `<input class="ps-modern-input li-edit-desc" type="text" placeholder="Physical description..." value="${a.description ? a.description.replace(/"/g, '&quot;') : ''}" style="font-size: 0.65rem; color: #3b82f6; padding: 4px; border: 1px solid transparent; background: transparent;" />`;
            }
            rowHtml += `</div>`;

            const row = $(`
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 4px;">
                    ${rowHtml}
                    <div style="display: flex; gap: 6px; align-items: center; margin-left: 10px;">
                        <button type="button" class="ps-modern-btn secondary li-always-include ${a.alwaysInclude ? 'active' : ''}" title="Always include this character" style="padding: 2px 6px; font-size: 0.6rem; color: ${a.alwaysInclude ? '#10b981' : 'var(--text-muted)'}; border-color: ${a.alwaysInclude ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-thumbtack"></i></button>
                        <button type="button" class="ps-modern-btn secondary li-never-include ${a.neverInclude ? 'active' : ''}" title="Never include this character" style="padding: 2px 6px; font-size: 0.6rem; color: ${a.neverInclude ? '#ef4444' : 'var(--text-muted)'}; border-color: ${a.neverInclude ? 'rgba(239,68,68,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-ban"></i></button>
                        <button class="ps-modern-btn secondary li-remove-assign" data-idx="${idx}" style="padding: 2px 6px; font-size: 0.6rem; color: #ef4444; border-color: rgba(239,68,68,0.3);"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
            `);

            row.find(".li-edit-char").on("input", function() { a.character = $(this).val(); saveProfileToMemory(); });
            if (showMatchKw) {
                row.find(".li-edit-match").on("input", function() { a.match_keywords = $(this).val(); saveProfileToMemory(); });
            }
            if (showLoras) {
                row.find(".li-edit-lora").on("input", function() { a.lora = $(this).val(); saveProfileToMemory(); });
            }
            if (showBooru) {
                row.find(".li-edit-booru").on("input", function() { a.booru_tags = $(this).val(); saveProfileToMemory(); });
                row.find(".li-edit-booru").on("blur", function() {
                    if (a.booru_tags && danbooruTagsMap && danbooruTagsMap.size > 0) {
                        const repaired = repairBooruTags(a.booru_tags);
                        if (repaired !== a.booru_tags) {
                            a.booru_tags = repaired;
                            $(this).val(repaired);
                            saveProfileToMemory();
                        }
                    }
                });
            }
            if (showDesc) {
                row.find(".li-edit-desc").on("input", function() { a.description = $(this).val(); saveProfileToMemory(); });
            }
            row.find(".li-always-include").on("click", function() { a.alwaysInclude = !a.alwaysInclude; if (a.alwaysInclude) a.neverInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });
            row.find(".li-never-include").on("click", function() { a.neverInclude = !a.neverInclude; if (a.neverInclude) a.alwaysInclude = false; saveProfileToMemory(); liRenderAssignmentTable(li, charKey, s); });

            row.find(".li-remove-assign").on("click", function() {
                assignments.splice(idx, 1);
                setModeCharacterAssignments(li, charKey, assignments);
                saveProfileToMemory();
                liRenderAssignmentTable(li, charKey, s);
            });
            table.append(row);
        });
    }

    function toggleQuickGenButton() {
        const s = getLocalProfile()?.imageGen;
        if (s && s.enabled && s.triggerMode === 'manual') {
            $("#kazuma_quick_gen").css("display", "flex");
        } else {
            $("#kazuma_quick_gen").css("display", "none");
        }
    }

    async function igTestConnection() {
        try {
            const res = await fetch('/api/sd/comfy/ping', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: getLocalProfile().imageGen.comfyUrl }) });
            if (res.ok) { toastr.success("ComfyUI Connected!"); await igFetchComfyLists(); } else throw new Error("Ping failed");
        } catch (e) { toastr.error("Connection Failed: " + e.message); }
    }

    async function igPopulateWorkflows() {
        const sel = $("#ig_workflow_list"); sel.empty();
        try {
            const res = await fetch('/api/sd/comfy/workflows', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: getLocalProfile().imageGen.comfyUrl }) });
            if (res.ok) {
                const wfs = await res.json();
                wfs.forEach(w => sel.append(`<option value="${w}">${w}</option>`));
                if (getLocalProfile().imageGen.currentWorkflowName && wfs.includes(getLocalProfile().imageGen.currentWorkflowName)) {
                    sel.val(getLocalProfile().imageGen.currentWorkflowName);
                } else if (wfs.length > 0) {
                    sel.val(wfs[0]); getLocalProfile().imageGen.currentWorkflowName = wfs[0]; saveProfileToMemory();
                }
            }
        } catch (e) { sel.append('<option disabled>Failed to load</option>'); }
    }

    async function igNewWorkflowClick() {
        let name = await prompt("New workflow file name (e.g. 'my_flux.json'):");
        if (!name) return; if (!name.toLowerCase().endsWith('.json')) name += '.json';
        try {
            const res = await fetch('/api/sd/comfy/save-workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name, workflow: '{}' }) });
            if (!res.ok) throw new Error(await res.text());
            toastr.success("Workflow created!"); await igPopulateWorkflows(); $("#ig_workflow_list").val(name).trigger('change');
            setTimeout(igOpenWorkflowEditorClick, 500);
        } catch (e) { toastr.error(e.message); }
    }

    async function igDeleteWorkflowClick() {
        const name = getLocalProfile().imageGen.currentWorkflowName;
        if (!name) return; if (!confirm(`Delete ${name}?`)) return;
        try {
            const res = await fetch('/api/sd/comfy/delete-workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name }) });
            if (!res.ok) throw new Error(await res.text());
            toastr.success("Deleted."); await igPopulateWorkflows();
        } catch (e) { toastr.error(e.message); }
    }

    async function igOpenWorkflowEditorClick() {
        const name = getLocalProfile().imageGen.currentWorkflowName;
        if (!name) return toastr.warning("No workflow selected");
        let loadedContent = "{}";
        try {
            const res = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name }) });
            if (res.ok) {
                const rawBody = await res.json(); let jsonObj = rawBody;
                if (typeof rawBody === 'string') { try { jsonObj = JSON.parse(rawBody); } catch(e) {} }
                loadedContent = JSON.stringify(jsonObj, null, 4);
            }
        } catch (e) { toastr.error("Failed to load file. Starting empty."); }

        let currentJsonText = loadedContent;
        const $container = $(`
            <div style="display: flex; flex-direction: column; width: 100%; gap: 10px; font-family: 'Inter', sans-serif; color: var(--text-main);">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                    <h3 style="margin:0; color: var(--gold);">${name}</h3>
                    <div style="display:flex; gap:8px;">
                        <button class="ps-modern-btn secondary wf-format" title="Beautify JSON"><i class="fa-solid fa-align-left"></i> Format</button>
                        <button class="ps-modern-btn secondary wf-import" title="Upload .json file"><i class="fa-solid fa-upload"></i> Import</button>
                        <button class="ps-modern-btn secondary wf-export" title="Download .json file"><i class="fa-solid fa-download"></i> Export</button>
                        <input type="file" class="wf-file-input" accept=".json" style="display:none;" />
                    </div>
                </div>
                <div style="display: flex; gap: 15px;">
                    <textarea class="ps-modern-input wf-textarea" spellcheck="false" style="flex: 1; min-height: 500px; font-family: 'Consolas', 'Monaco', monospace; white-space: pre; resize: none; font-size: 13px; line-height: 1.4; background: #000;"></textarea>
                    <div style="width: 250px; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid var(--border-color); padding-left: 10px; max-height: 500px;">
                        <h4 style="margin: 0 0 10px 0; color: var(--text-muted);">Placeholders</h4>
                        <div class="wf-list" style="overflow-y: auto; flex: 1; padding-right: 5px;"></div>
                    </div>
                </div>
            </div>
        `);

        const $textarea = $container.find('.wf-textarea'); const $list = $container.find('.wf-list'); const $fileInput = $container.find('.wf-file-input');
        $textarea.val(currentJsonText);

        KAZUMA_PLACEHOLDERS.forEach(item => {
            const $itemDiv = $('<div></div>').css({ 'padding': '8px', 'margin-bottom': '6px', 'background': 'rgba(255,255,255,0.05)', 'border-radius': '6px', 'border': '1px solid transparent', 'transition': '0.2s' });
            $itemDiv.append($('<span></span>').text(item.key).css({'font-weight': 'bold', 'color': 'var(--gold)', 'font-family': 'monospace'})).append($('<div></div>').text(item.desc).css({ 'font-size': '0.7rem', 'color': 'var(--text-muted)', 'margin-top': '4px' }));
            $list.append($itemDiv);
        });

        const updateState = () => {
            currentJsonText = $textarea.val();
            $list.children().each(function() {
                const cleanKey = $(this).find('span').first().text().replace(/"/g, '');
                if (currentJsonText.includes(cleanKey)) $(this).css({'border-color': '#10b981', 'background': 'rgba(16, 185, 129, 0.1)'});
                else $(this).css({'border-color': 'transparent', 'background': 'rgba(255,255,255,0.05)'});
            });
        };
        $textarea.on('input', updateState); setTimeout(updateState, 100);

        $container.find('.wf-format').on('click', () => { try { $textarea.val(JSON.stringify(JSON.parse($textarea.val()), null, 4)); updateState(); toastr.success("Formatted"); } catch(e) { toastr.warning("Invalid JSON"); } });
        $container.find('.wf-import').on('click', () => $fileInput.click());
        $fileInput.on('change', (e) => { if (!e.target.files[0]) return; const r = new FileReader(); r.onload = (ev) => { $textarea.val(ev.target.result); updateState(); toastr.success("Imported"); }; r.readAsText(e.target.files[0]); $fileInput.val(''); });
        $container.find('.wf-export').on('click', () => { try { JSON.parse(currentJsonText); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([currentJsonText], {type:"application/json"})); a.download = name; a.click(); } catch(e) { toastr.warning("Invalid content"); } });

        const popup = new Popup($container, POPUP_TYPE.CONFIRM, '', { okButton: 'Save Changes', cancelButton: 'Cancel', wide: true, large: true, onClosing: () => { try { JSON.parse(currentJsonText); return true; } catch (e) { toastr.error("Invalid JSON."); return false; } } });
        if (await popup.show()) {
            try {
                const res = await fetch('/api/sd/comfy/save-workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name, workflow: JSON.stringify(JSON.parse(currentJsonText)) }) });
                if (!res.ok) throw new Error(await res.text()); toastr.success("Workflow Saved!");
            } catch (e) { toastr.error("Save Failed."); }
        }
    }

    function showKazumaProgress(text = "Processing...") {
        if ($("#kazuma_progress_overlay").length === 0) {
            $("body").append(`
                <div id="kazuma_progress_overlay" style="position: fixed; bottom: 20px; right: 20px; width: 300px; background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 15px; z-index: 99999; box-shadow: 0 10px 30px rgba(0,0,0,0.8); display: none; align-items: center; gap: 15px; font-family: 'Inter', sans-serif;">
                    <div style="flex:1">
                        <span id="kazuma_progress_text" style="font-weight: 600; font-size: 0.85rem; color: #fff; margin-bottom: 8px; display: block;">Generating Image...</span>
                        <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                            <div style="height: 100%; width: 100%; background: linear-gradient(45deg, #a855f7 25%, transparent 25%, transparent 50%, #a855f7 50%, #a855f7 75%, transparent 75%, transparent); background-size: 20px 20px; animation: kazuma-stripe-anim 1s linear infinite;"></div>
                        </div>
                    </div>
                </div>
                <style>@keyframes kazuma-stripe-anim { 0% { background-position: 0 0; } 100% { background-position: 20px 0; } }</style>
            `);
        }
        $("#kazuma_progress_text").text(text); $("#kazuma_progress_overlay").css("display", "flex");
    }

    function getManualImageSelectableAssignments(li, charKey) {
        ensureLoraIntelDefaults(li);
        ensureStructuredCharacterAssignments(li, charKey);
        return getModeCharacterAssignments(li, charKey)
            .map(ensureStructuredCharacterAssignment)
            .filter(a => !a.neverInclude && String(a.character || "").trim());
    }

    function normalizeManualImageScene(scene) {
        const assignments = Array.isArray(scene?.assignments)
            ? scene.assignments.map(ensureStructuredCharacterAssignment).filter(a => a && !a.neverInclude)
            : [];
        const positions = Array.isArray(scene?.positions)
            ? scene.positions.map(p => ({
                label: String(p?.label || "").trim(),
                prompt: String(p?.prompt || "").trim()
            })).filter(p => p.label && p.prompt)
            : [];
        return { assignments, positions };
    }

    function buildManualImageSceneInstruction(scene, s, li, booruStd = false) {
        const normalized = normalizeManualImageScene(scene);
        const lines = [];
        if (normalized.assignments.length > 0) {
            const names = normalized.assignments.map(a => a.character || "character").join(", ");
            lines.push(`Manual scene cast override: include exactly these analyzed character(s) from the selector when deciding who is present: ${names}. Ignore match-keyword absence for these characters for this generation. Do not add other analyzed characters just because their match keywords appear elsewhere.`);

            const loraLines = li?.ensureLoras ? normalized.assignments.map(a => {
                if (!a.lora) return "";
                const keywords = getVrtlLoraIdentityKeywords(a.lora);
                const keywordText = keywords && keywords.length > 0 ? `; exact activation keyword(s): ${keywords.join(", ")}` : "";
                return `${a.character || "character"} -> ${a.lora}${keywordText}`;
            }).filter(Boolean) : [];
            if (loraLines.length > 0) {
                lines.push(`Manual LoRA character selection: ${loraLines.join(" | ")}. Use this only to identify the selected people; keep action, pose, expression, clothing state, camera, and setting grounded in the latest chat scene.`);
            }

            const allowStoredAppearanceGuidance = s?.promptStyle !== "zimage";
            const booruLines = allowStoredAppearanceGuidance && li?.useDanbooruTags
                ? normalized.assignments.map(a => {
                    const tagBlock = getStableAssignmentTagBlock(a, li);
                    return tagBlock ? `${a.character || "character"}: ${tagBlock}` : "";
                }).filter(Boolean)
                : [];
            if (booruLines.length > 0) {
                if (booruStd || isNaturalLanguageImageStyle(s?.promptStyle)) {
                    lines.push(`Manual selected character appearance cues. Merge these into prose naturally and do not paste them as a tag dump: ${booruLines.join(" | ")}`);
                } else {
                    lines.push(`Manual selected character booru tags. Use these as the character appearance tags for the selected scene cast: ${booruLines.join(" | ")}`);
                }
            }
        }

        if (normalized.positions.length > 0) {
            lines.push(`MANDATORY selected adult action override: ${normalized.positions.map(p => `${p.label}: ${p.prompt}`).join(" | ")}. Apply the selected sex act/position to the selected visible adult character(s) even if the latest chat scene is doing a different action. Preserve the scene context around it: same environment, background, lighting, camera mood, visible participants, identities, clothing/nudity state unless the selected act logically requires shifting or opening clothing, and any important props. Change only the action, pose, body placement, and contact needed to depict the selected act clearly. Do not skip this override.`);
        }

        return lines.join("\n");
    }

    function showManualImageSceneSelector(s, li, charKey) {
        const assignments = getManualImageSelectableAssignments(li, charKey);
        if (assignments.length === 0) {
            toastr.warning("No analyzed characters available. Analyze or add character assignments first.");
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            let done = false;
            const finish = (value) => {
                if (done) return;
                done = true;
                $overlay.remove();
                resolve(value ? normalizeManualImageScene(value) : null);
            };

            const renderAssignmentRow = (a, idx) => {
                const tagBlock = getStableAssignmentTagBlock(a, li) || getAssignmentTagBlock(a, li) || "";
                const modeLines = [];
                if (li?.ensureLoras) {
                    const loraText = a.lora ? `<span style="color:#a855f7;">${psEscapeText(a.lora)}</span>` : '<span style="color:var(--text-muted);">No LoRA</span>';
                    modeLines.push(`<div style="font-size:0.67rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">LoRA: ${loraText}</div>`);
                }
                if (li?.useDanbooruTags) {
                    const tagText = tagBlock ? psEscapeText(tagBlock) : "No booru tags";
                    modeLines.push(`<div style="font-size:0.67rem; color:#10b981; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${psEscapeAttr(tagBlock)}">Tags: ${tagText}</div>`);
                }
                if (modeLines.length === 0) {
                    modeLines.push('<div style="font-size:0.67rem; color:var(--text-muted);">No LoRA/Booru mode enabled; selection will only force scene cast.</div>');
                }
                return `
                    <div class="ig-manual-scene-row" style="display:grid; grid-template-columns: auto minmax(0, 1fr) auto; gap:10px; align-items:center; padding:10px; background:rgba(0,0,0,0.18); border:1px solid var(--border-color); border-radius:8px;">
                        <input type="checkbox" class="ig-manual-scene-check" data-idx="${idx}" style="width:18px; height:18px;" />
                        <div style="min-width:0;">
                            <div style="font-size:0.85rem; font-weight:800; color:var(--text-main);">${psEscapeText(a.character || `Character ${idx + 1}`)}</div>
                            ${modeLines.join("")}
                        </div>
                        <button type="button" class="ps-modern-btn primary ig-manual-scene-one" data-idx="${idx}" style="background:var(--gold); color:#000; padding:6px 10px; font-size:0.7rem; font-weight:800;">Use Only</button>
                    </div>
                `;
            };

            const positionOptions = NSFW_POSITION_PRESETS
                .filter(p => p.prompt)
                .map((p, idx) => `
                    <label style="display:flex; align-items:center; gap:8px; padding:7px 8px; background:rgba(0,0,0,0.14); border:1px solid var(--border-color); border-radius:7px; cursor:pointer;">
                        <input type="checkbox" class="ig-manual-position-check" data-idx="${idx}" style="width:16px; height:16px;" />
                        <span style="font-size:0.76rem; font-weight:700; color:var(--text-main);">${psEscapeText(p.label)}</span>
                    </label>
                `).join("");

            const $overlay = $(`
                <div class="ig-manual-scene-overlay" style="position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.72); font-family:'Inter', sans-serif;">
                    <style>
                        @media (max-width: 560px) {
                            .ig-manual-scene-overlay { align-items: stretch !important; padding: 8px !important; box-sizing: border-box !important; }
                            .ig-manual-scene-dialog { width: 100% !important; max-height: 100% !important; border-radius: 12px !important; }
                            .ig-manual-scene-header { align-items: flex-start !important; padding: 12px !important; }
                            .ig-manual-scene-body { padding: 10px !important; }
                            .ig-manual-scene-row { grid-template-columns: auto minmax(0, 1fr) !important; gap: 8px !important; }
                            .ig-manual-scene-one { grid-column: 1 / -1 !important; width: 100% !important; justify-content: center !important; }
                            .ig-manual-scene-position-grid { grid-template-columns: 1fr !important; }
                            .ig-manual-scene-footer { padding: 10px !important; flex-direction: column-reverse !important; }
                            .ig-manual-scene-footer button { width: 100% !important; justify-content: center !important; }
                        }
                    </style>
                    <div class="ig-manual-scene-dialog" style="width:min(760px, calc(100vw - 32px)); max-height:calc(100vh - 48px); display:flex; flex-direction:column; background:#18181b; border:1px solid var(--border-color); border-radius:14px; box-shadow:0 18px 60px rgba(0,0,0,0.65); overflow:hidden;">
                        <div class="ig-manual-scene-header" style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; border-bottom:1px solid var(--border-color);">
                            <div>
                                <div style="font-size:1rem; font-weight:900; color:var(--gold);"><i class="fa-solid fa-users-viewfinder"></i> Select Scene Characters</div>
                                <div style="font-size:0.73rem; color:var(--text-muted); margin-top:3px;">Choose one with Use Only, or check multiple characters and Send Selected. This overrides match keywords for this render only.</div>
                            </div>
                            <button type="button" class="ps-modern-btn secondary ig-manual-scene-cancel" style="padding:6px 10px;"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                        <div class="ig-manual-scene-body" style="padding:14px 18px; overflow:auto; display:flex; flex-direction:column; gap:10px;">
                            ${assignments.map(renderAssignmentRow).join("")}
                            <details style="margin-top:4px; background:rgba(168,85,247,0.06); border:1px solid rgba(168,85,247,0.18); border-radius:9px; padding:10px;">
                                <summary style="cursor:pointer; user-select:none; font-size:0.82rem; font-weight:800; color:#c084fc;"><i class="fa-solid fa-venus-mars"></i> Sex-position action override</summary>
                                <div style="font-size:0.68rem; color:var(--text-muted); margin:8px 0 10px;">When selected, these override the current action/pose while keeping the scene environment, clothing, lighting, and background context.</div>
                                <div class="ig-manual-scene-position-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:7px;">${positionOptions}</div>
                            </details>
                        </div>
                        <div class="ig-manual-scene-footer" style="display:flex; justify-content:flex-end; gap:10px; padding:14px 18px; border-top:1px solid var(--border-color);">
                            <button type="button" class="ps-modern-btn secondary ig-manual-scene-cancel">Cancel</button>
                            <button type="button" class="ps-modern-btn primary ig-manual-scene-send" style="background:var(--gold); color:#000; font-weight:900;">Send Selected</button>
                        </div>
                    </div>
                </div>
            `);

            const readPositions = () => $overlay.find(".ig-manual-position-check:checked").map(function() {
                return NSFW_POSITION_PRESETS.filter(p => p.prompt)[parseInt($(this).attr("data-idx"), 10)];
            }).get().filter(Boolean);

            $("body").append($overlay);
            $overlay.find(".ig-manual-scene-one").on("click", function() {
                const idx = parseInt($(this).attr("data-idx"), 10);
                finish({ assignments: [assignments[idx]].filter(Boolean), positions: readPositions() });
            });
            $overlay.find(".ig-manual-scene-send").on("click", function() {
                const selected = $overlay.find(".ig-manual-scene-check:checked").map(function() {
                    return assignments[parseInt($(this).attr("data-idx"), 10)];
                }).get().filter(Boolean);
                if (selected.length === 0) {
                    toastr.warning("Select at least one character, or click Use Only on a row.");
                    return;
                }
                finish({ assignments: selected, positions: readPositions() });
            });
            $overlay.find(".ig-manual-scene-cancel").on("click", () => finish(null));
            $overlay.on("click", function(e) {
                if (e.target === this) finish(null);
            });
        });
    }

    async function igManualGenerate() {
        const s = getLocalProfile()?.imageGen;
        if (!s || !s.enabled) return;

        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        let manualScene = null;
        try {
            if (s.manualSceneSelector) {
                manualScene = await showManualImageSceneSelector(s, li, charKey);
                if (!manualScene) return;
            }
            activeManualImageScene = manualScene;
            const source = s.manualPromptSource || "comfy_llm";
            showKazumaProgress(source === "sillytavern" ? "Analyzing Scene..." : "Preparing Scene...");

            let promptText = "";
            let skipLeadPrefix = false;
            let aiText = "";
            if (source === "sillytavern") {
                let gen;
                if (s.generatorBackend === "direct") {
                    gen = await generateImagePromptText({ manualScene });
                } else {
                    gen = null;
                    await useMeguminEngine(async () => {
                        gen = await generateImagePromptText({ manualScene });
                    }, "Megumin Image");
                }
                promptText = gen ? gen.prompt : "";
                skipLeadPrefix = !!(gen && gen.skipLeadPrefix);
            } else {
                const lastMessage = (getContext().chat || []).filter(m => !m.is_system).slice(-1)[0];
                const sceneText = getSceneSnapshotForMessage(lastMessage);
                const latestSceneText = getLatestVisualSceneText(lastMessage);
                const selectedAssignments = normalizeManualImageScene(manualScene).assignments;
                const selectedPositions = normalizeManualImageScene(manualScene).positions;
                if (source === "comfy_llm") {
                    const nanoContext = buildComfyNanoPromptContext(s, sceneText, {
                        assignments: selectedAssignments,
                        positions: selectedPositions
                    });
                    promptText = nanoContext.fallbackPrompt;
                    aiText = nanoContext.aiText;
                } else {
                    const position = selectedPositions[0] || detectPositionPresetFromScene(latestSceneText);
                    promptText = buildDeterministicBackgroundPrompt(s, latestSceneText, {
                        assignments: selectedAssignments.length ? selectedAssignments : null,
                        position,
                        sceneType: position || isExplicitSceneText(latestSceneText) ? "explicit" : "normal"
                    });
                }
            }

            const imgRegex = /<img\s+prompt=["'](.*?)["']\s*\/?>/i;
            const match = promptText.match(imgRegex);
            if (match) promptText = match[1];

            toastr.info(isRunpodReady(getLocalProfile().imageGen) ? "Sending to RunPod..." : "Sending to ComfyUI...", "Megumin Suite");
            await igGenerateWithComfy(promptText, null, {
                manualScene,
                aiText: aiText || promptText,
                requireAiTextWorkflow: source === "comfy_llm",
                skipLeadPrefix: source === "comfy_llm" ? true : skipLeadPrefix
            });

        } catch(e) {
            console.error(e);
            $("#kazuma_progress_overlay").hide();
            toastr.error(e?.message || "Manual generation failed.");
        } finally {
            activeImageGenRequest = null;
            activeManualImageScene = null;
        }
    }

    async function igRenderManualPrompt() {
        const s = getLocalProfile()?.imageGen;
        if (!s || !s.enabled) return toastr.warning("Image Generation must be enabled first.");
        const promptText = String($("#ig_manual_prompt").val() || s.manualPrompt || "").trim();
        if (!promptText) return toastr.warning("Manual prompt cannot be empty.");
        s.manualPrompt = promptText;
        saveProfileToMemory();

        showKazumaProgress("Preparing Manual Image...");
        try {
            await igGenerateWithComfy(promptText, null);
        } catch (e) {
            $("#kazuma_progress_overlay").hide();
            toastr.error("Manual image render failed: " + e.message);
        }
    }

    function igAddCharacterInfoToManualPrompt(s, li, charKey) {
        ensureLoraIntelDefaults(li);
        if (!li || getModeCharacterAssignments(li, charKey).length === 0) {
            toastr.warning("No character assignments available. Analyze characters first.");
            return;
        }
        let assignments = getMatchedCharacterAssignments(li, charKey);
        if (assignments.length === 0) assignments = getModeCharacterAssignments(li, charKey).map(ensureStructuredCharacterAssignment).filter(a => !a.neverInclude);

        const snippets = assignments.map((a) => {
            const tagBlock = getAssignmentTagBlock(a, li);
            return tagBlock || "";
        }).filter(Boolean);

        if (snippets.length === 0) {
            toastr.warning("No enabled character tag fields to add.");
            return;
        }

        const next = appendPromptTextToTextarea("#ig_manual_prompt", snippets.join(", "));
        s.manualPrompt = next;
        saveProfileToMemory();
        toastr.success("Character info added to manual prompt.");
    }

    // New Helper Function for generating the prompt text
    function getMatchedBooruTags(li, charKey, manualAssignments = null) {
        if (!li || !li.enabled || !li.useDanbooruTags) return [];
        const matched = [];

        for (const a of getActiveCharacterAssignments(li, charKey, manualAssignments)) {
            ensureStructuredCharacterAssignment(a);
            const tagBlock = getAssignmentTagBlock(a, li);
            if (!tagBlock) continue;
            matched.push({ character: a.character, tags: tagBlock });
        }
        return matched;
    }

    function getMatchedCharacterAssignments(li, charKey, manualAssignments = null) {
        if (!li || !li.enabled) return [];
        return getActiveCharacterAssignments(li, charKey, manualAssignments);
    }

    function getActiveCharacterAssignments(li, charKey, manualAssignments = null) {
        if (!li) return [];
        if (Array.isArray(manualAssignments) && manualAssignments.length > 0) {
            return manualAssignments.map(ensureStructuredCharacterAssignment).filter(a => a && !a.neverInclude);
        }
        const assignments = getModeCharacterAssignments(li, charKey)
            .map(ensureStructuredCharacterAssignment)
            .filter(a => !a.neverInclude);
        if (assignments.length === 0) return [];

        const recentChat = getRecentChatForLoraKeywords();
        const allowEmptyMatch = assignments.length <= 1;
        return assignments
            .filter(a => assignmentMatchesRecentChat(a, recentChat, allowEmptyMatch));
    }

    function getCurrentCharacterTextContext() {
        const context = getContext();
        if (context.characterId === undefined || context.characterId === null || !context.characters?.[context.characterId]) {
            return { description: "", firstMessage: "" };
        }
        const character = context.characters[context.characterId];
        return {
            description: String(character.description || character.desc || "").trim(),
            firstMessage: String(character.first_mes || character.first_message || character.firstMessage || "").trim()
        };
    }

    function getUserDisplayName() {
        const context = getContext();
        const raw = typeof substituteParams === 'function'
            ? substituteParams('{{user}}')
            : (context.name1 || context.userName || context.user_name || "the player character");
        const name = String(raw || "").trim();
        if (!name || name === "{{user}}") return "the player character";
        return name;
    }

    function getUserPersonaText() {
        if (typeof substituteParams !== 'function') return "";
        const raw = String(substituteParams('{{persona}}') || "").trim();
        if (!raw || raw === "{{persona}}" || /^no user persona found\.?$/i.test(raw)) return "";
        return cleanMessageTextForKeywords(raw);
    }

    function isUserPresentInRecentScene() {
        const context = getContext();
        const chat = context.chat || [];
        if (chat.length === 0) return false;
        const recent = chat.filter(m => !m.is_system).slice(-5);
        if (recent.some(m => m.is_user && cleanMessageTextForKeywords(m.mes))) return true;

        const userName = getUserDisplayName().toLowerCase();
        if (!userName || userName === "the player character") return false;
        const recentAiText = recent
            .filter(m => !m.is_user)
            .map(m => cleanMessageTextForKeywords(m.mes))
            .join("\n")
            .toLowerCase();
        return keywordAppearsInText(userName, recentAiText);
    }

    function buildPersonaImageGuidance(s, booruStd = false) {
        if (!isUserPresentInRecentScene()) return "";

        const userName = getUserDisplayName();
        const persona = getUserPersonaText();
        const personaLine = s?.promptStyle !== "zimage" && persona ? ` Persona appearance: ${persona}` : "";
        if (s?.promptPerspective === "pov") {
            return `The player character (${userName}) is present as the camera/viewpoint. Do not omit them: show visible first-person body cues when appropriate, such as hands, arms, torso, lap, clothing, shadow, reflection, or interaction contact.${personaLine}`;
        }
        if (isNaturalLanguageImageStyle(s?.promptStyle) || booruStd) {
            return `The player character (${userName}) is physically present in the scene. Include them as a visible participant, not just an implied observer. Describe their placement, interaction with the other character(s), pose/body contact, and visible appearance.${personaLine}`;
        }
        return `The player character (${userName}) is physically present. Include them as visible Anima-style prompt content, using tags for player/persona presence, count/composition, pose, interaction, body contact, clothing, and visible appearance. Do not make the scene solo unless the chat clearly says they are off-screen.${personaLine}`;
    }

    function getAssignmentTagBlock(a, li = null) {
        ensureStructuredCharacterAssignment(a);
        const parts = getAssignmentTagParts(a, li);
        return normalizeGeneratedTagField(parts.join(', '));
    }

    function getPlainAssignmentText(a) {
        const stableStructured = [
            a.character_tag,
            a.series_tag,
            a.physical_tags,
            a.clothing_tags
        ].filter(Boolean).join(', ');
        const plainDescription = normalizeGeneratedTagField(a.plain_description || "");
        const fullTagDump = normalizeGeneratedTagField(a.booru_tags || "");
        const plainLooksAutoSeeded = plainDescription && fullTagDump && plainDescription === fullTagDump;
        return plainLooksAutoSeeded
            ? stableStructured
            : (a.plain_description || a.description || stableStructured);
    }

    function getStableAssignmentTagBlock(a, li = null) {
        ensureStructuredCharacterAssignment(a);
        if (li?.assignmentViewMode === 'plain') {
            return normalizeGeneratedTagField(getPlainAssignmentText(a));
        }
        const globalToggles = li?.tagFieldToggles || {};
        const rowToggles = a?.tagFieldToggles || {};
        const enabled = (key) => globalToggles[key] !== false && rowToggles[key] !== false;
        return normalizeGeneratedTagField([
            enabled("characterTag") ? a.character_tag : "",
            enabled("seriesTag") ? a.series_tag : "",
            enabled("physicalTags") ? a.physical_tags : "",
            enabled("clothingTags") ? a.clothing_tags : ""
        ].filter(Boolean).join(', '));
    }

    function getMatchedCharacterGuidance(li, charKey, manualAssignments = null) {
        if (!li || !li.enabled || !li.useDanbooruTags) return [];
        return getActiveCharacterAssignments(li, charKey, manualAssignments)
            .map(a => ({ character: a.character || "character", tags: getStableAssignmentTagBlock(a, li) }))
            .filter(a => a.tags);
    }

    function getAssignmentTagParts(a, li) {
        ensureStructuredCharacterAssignment(a);
        if (li?.assignmentViewMode === 'plain') {
            return [getPlainAssignmentText(a)].filter(Boolean);
        }
        const globalToggles = li?.tagFieldToggles || {};
        const rowToggles = a?.tagFieldToggles || {};
        const enabled = (key) => globalToggles[key] !== false && rowToggles[key] !== false;
        return [
            enabled("characterTag") ? a.character_tag : "",
            enabled("seriesTag") ? a.series_tag : "",
            enabled("physicalTags") ? a.physical_tags : "",
            enabled("clothingTags") ? a.clothing_tags : ""
        ].filter(Boolean);
    }

    function shouldUseCharacterGuidance(s, li) {
        return !!(s && li && li.enabled && li.useDanbooruTags && li.promptAssemblyMode === 'structured');
    }

    function isBooruStandardImageMode(s, li) {
        return !!(s && li && li.enabled && li.useDanbooruTags && s.promptStyle === 'standard');
    }

    /**
     * LoRA Intelligence → Booru Tags toggle only (not Ensure LoRAs, not Character descriptions).
     * Stable leading-tags prepend and [[img1]] prefix line both use buildBooruStandardTagLead(), which checks this.
     */
    function isLoraIntelBooruTagsMode(li) {
        return !!(li && li.enabled && li.useDanbooruTags);
    }

    /** Comfy / preview prefix from `standardBooruLeadTags` when Booru Tags mode is on; empty otherwise. */
    function buildBooruStandardTagLead(s, li) {
        if (!s || !isLoraIntelBooruTagsMode(li)) return '';
        const raw = (s.standardBooruLeadTags && String(s.standardBooruLeadTags).trim()) ? String(s.standardBooruLeadTags).trim() : '';
        if (!raw) return '';
        return normalizeGeneratedTagField(raw);
    }

    async function generateImagePromptText(opts = null) {
        const s = getLocalProfile().imageGen;
        const li = s.loraIntel;
        const manualScene = normalizeManualImageScene(opts?.manualScene || activeManualImageScene);

        const chat = getContext().chat;
        const charKey = getCharacterKey() || "default";

        const lastMessages = opts?.chatText || chat.filter(m => !m.is_system).slice(-5).map(m => {
            const text = cleanMessageTextForKeywords(m.mes);
            return `${m.name}: ${text.trim()}`;
        }).join("\n\n");

        const booruStd = isBooruStandardImageMode(s, li);
        const booruStableLeadPrepend = buildBooruStandardTagLead(s, li);
        const allowStoredAppearanceGuidance = s.promptStyle !== "zimage";
        const manualAssignments = manualScene.assignments;
        const characterGuidance = allowStoredAppearanceGuidance && shouldUseCharacterGuidance(s, li) ? getMatchedCharacterGuidance(li, charKey, manualAssignments) : [];
        const guidedCharacters = characterGuidance.length > 0;
        const personaGuidance = buildPersonaImageGuidance(s, booruStd);
        const manualSceneInstruction = buildManualImageSceneInstruction(manualScene, s, li, booruStd);

        let styleStr;
        if (s.promptStyle === "illustrious") {
            styleStr = "Use Danbooru-style tags separated by commas.";
        } else if (s.promptStyle === "zimage") {
            styleStr = Z_IMAGE_PROMPT_INSTRUCTION;
            if (booruStableLeadPrepend) {
                styleStr += " Do not repeat the user's fixed leading-tags field; the app adds it after the generated description.";
            }
        } else if (s.promptStyle === "sdxl") {
            styleStr = "SDXL — output ONLY fluent English prose (one to several short paragraphs). Describe the subject, body, clothing, pose, expression, environment, lighting, and camera feel in full sentences. STRICTLY FORBIDDEN: comma-separated tag lists, Danbooru-style tokens with underscores, shorthand like \"1girl\" or \"solo\", or planning/meta text. If Extra Details contain shorthand or tag-like cues, translate every cue into natural language (e.g. a look-alike tag becomes a short phrase, never the raw token).";
            if (booruStableLeadPrepend) {
                styleStr += " Do NOT prepend or repeat the user's fixed leading-tags field; it is inserted automatically after your output when LoRA Intelligence Booru Tags mode is on.";
            }
        } else if (booruStd) {
            styleStr = "Write ONLY a flowing natural-language image description (full sentences, not comma-separated tag lists). Turn visual shorthand into prose—for example \"1girl, blue eyes, huge breasts\" becomes \"a woman with blue eyes and huge breasts.\" Describe actions, poses, and interactions in clear descriptive language.";
            if (booruStableLeadPrepend) {
                styleStr += " Do NOT output a leading comma-separated tag block; only the user's fixed \"leading tags\" field is prepended automatically after this step.";
            }
            styleStr += " If Extra Details lists scene cues and/or character-appearance Danbooru-style tags, merge them into your prose (translate into natural descriptions; do not paste them as a tag dump). Output prose for the scene only.";
        } else {
            styleStr = "Use a comma-separated list of detailed keywords and visual descriptors.";
        }
        if (li && li.enabled && li.useDanbooruTags && !isNaturalLanguageImageStyle(s.promptStyle) && !booruStd) {
            styleStr += " For Anima, use lowercase tags with spaces instead of underscores, escape literal parentheses in known character/series tags (example: saber \\(fate\\)), and do not combine story character names with look-alike tags.";
        }
        const maxAnimaTags = getAnimaMaxTags(s);
        if (maxAnimaTags && !isNaturalLanguageImageStyle(s.promptStyle) && !booruStd) {
            styleStr += ` Keep the complete prompt concise: output no more than ${maxAnimaTags} comma-separated tags total, prioritizing characters, action, pose, expression, camera, and setting.`;
        }
        styleStr += ` ${IMAGE_SCENE_FIDELITY_INSTRUCTION}`;
        if (s.structuredPromptRules) {
            styleStr += ` ${buildImagePromptStructureRules(s, booruStd)}`;
        }

        let perspStr = s.promptPerspective === "pov" ? "Frame the scene strictly from a First-Person (POV) perspective." : (s.promptPerspective === "character" ? "Focus intensely on the character's appearance." : "Describe the entire environment and atmosphere.");

        let extraStr = "None";
        if (booruStd) {
            const extraParts = [];
            const combinedExtra = [s.promptExtra, opts?.extraInstruction].map(v => String(v || "").trim()).filter(Boolean).join("\n");
            const pe = combinedExtra;
            if (pe) {
                extraParts.push(
                    booruStableLeadPrepend
                        ? `Scene tags and cues (from the user's Extra field, often comma-separated shorthand). Interpret and weave into your flowing description; translate into prose where needed. Do not paste this block unchanged as a prefix or suffix—the only automatic prefix is the separate \"leading tags\" field.\n${pe}`
                        : `Scene tags and cues (from the user's Extra field, often comma-separated shorthand). Interpret and weave into your flowing description; translate into prose where needed.\n${pe}`
                    );
            }
            if (guidedCharacters) {
                const guide = characterGuidance.map(m => `${m.character}: ${m.tags}`).join(' | ');
                extraParts.push(`Matched character references. Use these stable appearance cues for who is present, then derive action, pose, expression, state, setting, and composition from the chat scene. Translate tags into flowing prose; do not paste them as a tag block.\n${guide}`);
            } else if (allowStoredAppearanceGuidance && li && li.enabled) {
                const matchedBooru = getMatchedBooruTags(li, charKey, manualAssignments);
                if (matchedBooru.length > 0) {
                    const booruInstr = matchedBooru.map(m => `${m.character}: ${m.tags}`).join(' | ');
                    extraParts.push(`Character appearance cues (Danbooru-style tags per role). Weave into your flowing description: translate into prose (face, hair, eyes, figure, clothing, any named character look-alike tag). Do not emit them as a comma-separated prefix or block.\n${booruInstr}`);
                }
            }
            if (personaGuidance) {
                extraParts.push(`Player character visibility:\n${personaGuidance}`);
            }
            if (s.adultTagPrecision) {
                extraParts.push(IMAGE_ADULT_TAG_PRECISION_INSTRUCTION);
            }
            if (manualSceneInstruction) {
                extraParts.push(manualSceneInstruction);
            }
            if (s.includePromptExamples || s.promptStyle === "zimage") {
                extraParts.push(`Template example:\n${buildImagePromptExamples(s, booruStd)}`);
            }
            if (extraParts.length > 0) extraStr = extraParts.join("\n\n");
        } else {
            extraStr = [s.promptExtra, opts?.extraInstruction].map(v => String(v || "").trim()).filter(Boolean).join("\n") || "None";
            if (guidedCharacters) {
                const guide = characterGuidance.map(m => `${m.character}: ${m.tags}`).join(' | ');
                if (isNaturalLanguageImageStyle(s.promptStyle)) {
                    extraStr += `\nMatched character references. Use these stable appearance cues for who is present, then derive action, pose, expression, state, setting, and composition from the chat. Translate them into fluent English only: ${guide}`;
                } else {
                    extraStr += `\nMatched character references. Use these stable appearance cues for who is present, then derive action, pose, expression, state, setting, and composition from the chat. Keep Anima-style tags with spaces and escaped literal parentheses: ${guide}`;
                }
            } else if (allowStoredAppearanceGuidance && li && li.enabled) {
                const matchedBooru = getMatchedBooruTags(li, charKey, manualAssignments);
                if (matchedBooru.length > 0) {
                    const booruInstr = matchedBooru.map(m => `${m.character}: ${m.tags}`).join(' | ');
                    if (isNaturalLanguageImageStyle(s.promptStyle)) {
                        extraStr += `\nCharacter appearance shorthand (per role). Fold ONLY into flowing English prose—translate hair, eyes, figure, outfit, and any look-alike references; NEVER output as comma tags, underscores, or token lists: ${booruInstr}`;
                    } else {
                        extraStr += `\nCharacter appearance tags by role. Use these as Anima-style comma tags with spaces instead of underscores. Keep known character/series tags exact and escaped when they have parentheses. Do not combine story names with look-alike tags: ${booruInstr}`;
                    }
                }
            }
            if (personaGuidance) {
                extraStr += `\nPlayer character visibility: ${personaGuidance}`;
            }
            if (s.adultTagPrecision) {
                extraStr = appendImagePromptInstruction(extraStr, IMAGE_ADULT_TAG_PRECISION_INSTRUCTION);
            }
            if (manualSceneInstruction) {
                extraStr = appendImagePromptInstruction(extraStr, manualSceneInstruction);
            }
            if (s.includePromptExamples || s.promptStyle === "zimage") {
                extraStr = appendImagePromptInstruction(extraStr, `Template example: ${buildImagePromptExamples(s, booruStd)}`);
            }
        }

        activeImageGenRequest = { chatText: lastMessages, styleStr: styleStr, perspStr: perspStr, extraStr: extraStr, isZImage: s.promptStyle === "zimage" };

        let rawOutput;
        try {
            rawOutput = await generateQuietPrompt({ prompt: "___PS_IMAGE_GEN___" });
        } finally {
            activeImageGenRequest = null;
        }
        let finalPrompt = stripUtilityThinkingWrapper(rawOutput);
        if (s.promptStyle === "zimage" && findZImageForbiddenMinorTerm(finalPrompt)) {
            throw new Error("Z-Image prompt blocked: generated input contained forbidden minor-related wording.");
        }
        if (s.promptStyle === "illustrious") {
            finalPrompt = stripPreambleBeforeBooruTags(finalPrompt);
        }

        finalPrompt = sanitizePromptTags(finalPrompt);
        if (!isNaturalLanguageImageStyle(s.promptStyle) && !booruStd) {
            finalPrompt = normalizeAnimaGeneratedTags(finalPrompt);
        }
        finalPrompt = limitAnimaPromptTags(finalPrompt, s, li);

        return { prompt: finalPrompt, skipLeadPrefix: false };
    }

    function igReadBlobAsDataUrl(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }

    async function igMaybeCompressDataUrl(dataUrl, s) {
        let base64Clean = dataUrl;
        let format = igGetDataUrlFormat(dataUrl) || "png";
        if (s.compressImages) {
            base64Clean = await new Promise((resolve) => {
                const img = new Image();
                img.src = dataUrl;
                img.onload = () => {
                    const cvs = document.createElement('canvas');
                    cvs.width = img.width;
                    cvs.height = img.height;
                    cvs.getContext('2d').drawImage(img, 0, 0);
                    resolve(cvs.toDataURL("image/jpeg", 0.9));
                };
                img.onerror = () => resolve(dataUrl);
            });
            format = "jpeg";
        }
        return { base64Clean, format };
    }

    function igGetDataUrlFormat(dataUrl) {
        const match = String(dataUrl || "").match(/^data:image\/([^;]+);base64,/i);
        if (!match) return "";
        return match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
    }

    async function igAttachGeneratedImage(base64Clean, finalPrompt, target, format = "png") {
        const charName = getContext().characters[getContext().characterId]?.name || "User";
        const cleanBase64 = String(base64Clean || "").includes(",") ? String(base64Clean).split(",").pop() : String(base64Clean || "");
        const savedPath = await saveBase64AsFile(cleanBase64, charName, `${charName}_${humanizedDateTime()}`, format);
        const mediaAttach = {
            url: savedPath,
            type: "image",
            source: "generated",
            prompt: finalPrompt,
            title: finalPrompt,
            generation_type: "free",
            megumin_background: target?.metadata || undefined
        };

        if (target?.libraryOnly) {
            const s = getLocalProfile()?.imageGen;
            const automation = ensureBackgroundAutomationSettings(s);
            automation.library.push({
                id: `megumin-lib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                url: savedPath,
                filename: String(savedPath || "").split(/[\\/]/).filter(Boolean).pop() || "",
                prompt: finalPrompt,
                createdAt: Date.now(),
                ...(target.metadata || {})
            });
            if (automation.library.length > 500) automation.library.splice(0, automation.library.length - 500);
            saveProfileToMemory();
            refreshBatchLibraryInventory();
            if (!target.background) toastr.success("Batch image added to library.");
        } else if (target && target.message) {
            if (!target.message.extra) target.message.extra = {};
            if (!target.message.extra.media) target.message.extra.media = [];
            target.message.extra.media_display = "gallery";
            target.message.extra.media.push(mediaAttach);
            target.message.extra.media_index = target.message.extra.media.length - 1;
            if (typeof appendMediaToMessage === "function") appendMediaToMessage(target.message, target.element);
            await saveChat();
            if (!target.background) toastr.success("Gallery updated!");
        } else {
            const newMsg = { name: "Image Gen Kazuma", is_user: false, is_system: true, send_date: Date.now(), mes: "", extra: { media: [mediaAttach], media_display: "gallery", media_index: 0 }, force_avatar: "img/five.png" };
            getContext().chat.push(newMsg);
            await saveChat();
            if (typeof addOneMessage === "function") addOneMessage(newMsg);
            else await reloadCurrentChat();
            toastr.success("Image inserted!");
        }
    }

    async function attachLibraryImageToOrigin(libraryItem, origin) {
        const target = resolveBackgroundOrigin(origin);
        if (!target?.message) return false;
        if (!target.message.extra) target.message.extra = {};
        if (!Array.isArray(target.message.extra.media)) target.message.extra.media = [];
        target.message.extra.media_display = "gallery";
        target.message.extra.media.push({
            url: libraryItem.url,
            type: "image",
            source: "generated",
            prompt: libraryItem.prompt || "",
            title: libraryItem.prompt || "",
            generation_type: "free",
            megumin_background: { source: "qwen-library", libraryId: libraryItem.id }
        });
        target.message.extra.media_index = target.message.extra.media.length - 1;
        if (target.element?.length && typeof appendMediaToMessage === "function") {
            appendMediaToMessage(target.message, target.element);
        }
        await saveChat();
        return true;
    }

    function igRunpodCandidateToImage(candidate) {
        if (!candidate) return null;
        if (typeof candidate === "string") {
            const trimmed = candidate.trim();
            if (!trimmed) return null;
            if (/^https?:\/\//i.test(trimmed)) return { url: trimmed };
            if (/^data:image\//i.test(trimmed)) return { dataUrl: trimmed, format: igGetDataUrlFormat(trimmed) || "png" };
            return { dataUrl: `data:image/png;base64,${trimmed}`, format: "png" };
        }
        if (typeof candidate === "object") {
            if (candidate.data) return igRunpodCandidateToImage(candidate.data);
            if (candidate.base64) return igRunpodCandidateToImage(candidate.base64);
            if (candidate.image) return igRunpodCandidateToImage(candidate.image);
            if (candidate.url) return { url: candidate.url };
        }
        return null;
    }

    function igFindRunpodImageCandidate(statusData) {
        const output = statusData?.output ?? statusData;
        const firstOutput = Array.isArray(output) ? output[0] : null;
        const candidates = [
            output,
            firstOutput,
            output?.images?.[0],
            output?.image,
            output?.result?.images?.[0],
            output?.result?.image,
            output?.output?.images?.[0],
            output?.output?.image
        ];
        for (const candidate of candidates) {
            const found = igRunpodCandidateToImage(candidate);
            if (found) return found;
        }
        return null;
    }

    async function igResolveRunpodImageDataUrl(statusData) {
        const image = igFindRunpodImageCandidate(statusData);
        if (!image) {
            throw new Error("RunPod completed but no image data was found in the output.");
        }
        if (image.dataUrl) return image;
        const response = await fetch(image.url);
        if (!response.ok) throw new Error(`RunPod image download failed: ${response.status}`);
        const dataUrl = await igReadBlobAsDataUrl(await response.blob());
        return { dataUrl, format: igGetDataUrlFormat(dataUrl) || "png" };
    }

    async function igGenerateWithRunpod(workflow, finalPrompt, target, s) {
        const runpod = ensureRunpodSettings(s);
        if (!runpod.endpointId || !runpod.apiKey) {
            throw new Error("RunPod endpoint ID and API key are required.");
        }

        const endpointBase = `https://api.runpod.ai/v2/${encodeURIComponent(runpod.endpointId)}`;
        if (!target?.background) showKazumaProgress("Sending to RunPod...");
        const submitRes = await fetch(`${endpointBase}/run`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${runpod.apiKey}`
            },
            body: JSON.stringify({ input: { workflow, prompt: finalPrompt } })
        });
        if (!submitRes.ok) {
            const text = await submitRes.text().catch(() => "");
            throw new Error(`RunPod submit failed: ${submitRes.status}${text ? ` ${text.slice(0, 160)}` : ""}`);
        }

        const submitData = await submitRes.json();
        const jobId = submitData.id || submitData.jobId || submitData.job_id;
        if (!jobId) throw new Error("RunPod returned no job ID.");

        if (!target?.background) showKazumaProgress("Rendering on RunPod...");
        const started = Date.now();
        while (Date.now() - started <= runpod.timeoutMs) {
            await new Promise(resolve => setTimeout(resolve, runpod.pollIntervalMs));
            const statusRes = await fetch(`${endpointBase}/status/${encodeURIComponent(jobId)}`, {
                headers: { "Authorization": `Bearer ${runpod.apiKey}` }
            });
            if (!statusRes.ok) throw new Error(`RunPod status failed: ${statusRes.status}`);
            const statusData = await statusRes.json();
            const status = String(statusData.status || "").toUpperCase();

            if (status === "COMPLETED") {
                if (!target?.background) showKazumaProgress("Downloading...");
                const image = await igResolveRunpodImageDataUrl(statusData);
                const { base64Clean, format } = await igMaybeCompressDataUrl(image.dataUrl, s);
                await igAttachGeneratedImage(base64Clean, finalPrompt, target, format || image.format || "png");
                return;
            }
            if (["FAILED", "CANCELLED", "CANCELED", "TIMED_OUT"].includes(status)) {
                throw new Error(`RunPod job failed: ${JSON.stringify(statusData.error || statusData)}`);
            }
        }

        throw new Error("RunPod job timed out.");
    }

    async function igGenerateWithComfy(positivePrompt, target = null, opts = null) {
        const s = getLocalProfile().imageGen;
        const background = !!opts?.background;
        ensureImageGenLoraArrays(s);
        const manualScene = normalizeManualImageScene(opts?.manualScene || activeManualImageScene);
        const manualAssignments = manualScene.assignments;
        if (ensureRunpodSettings(s).enabled && ensureRunpodDropdownValues(s)) saveProfileToMemory();
        igSyncImageGenLoraFromDom(s);
        let raw = stripUtilityThinkingWrapper(String(positivePrompt ?? ""));
        if (s.promptStyle === "zimage" && blockForbiddenZImagePrompt(raw)) return;
        let finalPrompt;
        if (opts && opts.preserveStoredPrompt) {
            finalPrompt = raw.trim();
        } else {
            if (s.promptStyle === "illustrious") {
                raw = stripPreambleBeforeBooruTags(raw);
            }
            finalPrompt = sanitizePromptTags(raw);
            if (opts && opts.normalizeGeneratedPrompt && !isNaturalLanguageImageStyle(s.promptStyle)) {
                finalPrompt = normalizeAnimaGeneratedTags(finalPrompt);
            }
            finalPrompt = limitAnimaPromptTags(finalPrompt, s, s.loraIntel);
            if (!opts || !opts.skipLeadPrefix) {
                finalPrompt = ensureImageLeadPrefix(finalPrompt);
            }
        }
        if (s.promptStyle === "zimage" && blockForbiddenZImagePrompt(finalPrompt)) return;
        const aiText = String(opts?.aiText ?? finalPrompt).trim() || finalPrompt;

        // --- INTERCEPT PROMPT IF PREVIEW IS ENABLED ---
        if (s.previewPrompt && !background) {
            $("#kazuma_progress_overlay").hide(); // Hide the progress bar temporarily

            const isWorkflowAiPrompt = !!opts?.requireAiTextWorkflow;
            const $content = isWorkflowAiPrompt
                ? $(`
                    <div style="display:flex; flex-direction:column; gap:10px; font-family:'Inter',sans-serif;">
                        <div style="font-size:.82rem; color:var(--text-main); font-weight:700;">NanoGPT will generate the final prompt inside ComfyUI after you send this workflow.</div>
                        <div style="font-size:.7rem; color:var(--text-muted);">The text below is the scene-native <code>%ai_text%</code> source. <code>%prompt%</code> contains only configured UI/character/LoRA guidance as an API-error fallback.</div>
                        <textarea class="ps-modern-input ig-ai-source-preview" readonly style="height:180px; resize:vertical; font-family:monospace; font-size:.75rem; padding:10px;">${psEscapeText(aiText)}</textarea>
                        <details>
                            <summary style="cursor:pointer; font-size:.7rem; color:var(--text-muted);">Show configured-tag fallback</summary>
                            <textarea class="ps-modern-input ig-preview-textarea" style="height:100px; resize:vertical; font-family:monospace; font-size:.72rem; padding:10px; margin-top:7px;">${psEscapeText(finalPrompt)}</textarea>
                        </details>
                    </div>
                `)
                : $(`
                    <div style="display:flex; flex-direction:column; gap:10px; font-family: 'Inter', sans-serif;">
                        <div style="font-size: 0.85rem; color: var(--text-muted);">Review or modify the prompt before it goes to the image renderer.</div>
                        <textarea class="ps-modern-input ig-preview-textarea" style="height: 150px; resize: vertical; font-family: monospace; font-size: 0.85rem; padding: 10px;">${psEscapeText(finalPrompt)}</textarea>
                    </div>
                `);

            // CRITICAL FIX: SillyTavern destroys the popup HTML when it closes.
            // We MUST capture the text while the user is typing!
            let liveText = finalPrompt;
            $content.find(".ig-preview-textarea").on("input", function() {
                liveText = $(this).val();
            });

            const popup = new Popup(
                $content,
                POPUP_TYPE.CONFIRM,
                isWorkflowAiPrompt ? "Preview ComfyUI NanoGPT Request" : "Preview Image Prompt",
                { okButton: isWorkflowAiPrompt ? "Send to ComfyUI" : "Send to Renderer", cancelButton: "Cancel", wide: true }
            );
            const confirmed = await popup.show();

            if (!confirmed) {
                toastr.info("Generation cancelled.");
                return;
            }

            finalPrompt = liveText.trim();
            if (!finalPrompt) return toastr.warning("Prompt cannot be empty.");
            if (s.promptStyle === "zimage" && blockForbiddenZImagePrompt(finalPrompt)) return;

            showKazumaProgress("Preparing to Render..."); // Bring progress bar back
        }

        let workflowRaw;
        try {
            const res = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: s.currentWorkflowName }) });
            if (!res.ok) throw new Error("Load failed"); workflowRaw = await res.json();
        } catch (e) { return toastr.error(`Could not load ${s.currentWorkflowName}`); }

        let workflow = (typeof workflowRaw === 'string') ? JSON.parse(workflowRaw) : workflowRaw;
        const workflowHasAiText = igWorkflowContainsPlaceholder(workflow, "%ai_text%");
        if (opts?.requireAiTextWorkflow && !workflowHasAiText) {
            $("#kazuma_progress_overlay").hide();
            throw new Error(`The selected workflow "${s.currentWorkflowName}" has no %ai_text% input. Select anima_nanogpt.json or add %ai_text% to the NanoGPT node.`);
        }
        let finalSeed = parseInt(s.customSeed); if (finalSeed === -1 || isNaN(finalSeed)) finalSeed = Math.floor(Math.random() * 1000000000);

        const comfyLoraFiles = await ensureMeguminComfyLoraList(s);
        let loraPathCanonChanged = false;
        for (let i = 1; i <= 4; i++) {
            const key = i === 1 ? "selectedLora" : `selectedLora${i}`;
            const v = s[key];
            if (!v || v === "None" || v === "") continue;
            const r = resolveLoraPathForDropdown(v, comfyLoraFiles);
            if (r && r !== v) {
                s[key] = r;
                loraPathCanonChanged = true;
                const $dd = $(`#ig_lora_${i}`);
                if ($dd.length) $dd.val(r);
            }
        }
        if (loraPathCanonChanged) saveProfileToMemory();

        // --- LORA INTELLIGENCE INJECTION ---
        let slots = [s.selectedLora, s.selectedLora2, s.selectedLora3, s.selectedLora4];
        let weights = [parseFloat(s.selectedLoraWt) || 1.0, parseFloat(s.selectedLoraWt2) || 1.0, parseFloat(s.selectedLoraWt3) || 1.0, parseFloat(s.selectedLoraWt4) || 1.0];

        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        const hasManualLoraSelection = manualAssignments.length > 0;
        if (li && (hasManualLoraSelection || (li.enabled && li.ensureLoras)) && getModeCharacterAssignments(li, charKey).length > 0) {
            ensureImageGenLoraArrays(s);
            const locked = s.loraSlotLocked;
            const kwManaged = s.loraSlotKeywordManaged;

            const activeAssignments = getActiveCharacterAssignments(li, charKey, hasManualLoraSelection ? manualAssignments : null);

            const occupiedKeys = new Set();
            slots.forEach((sl, idx) => {
                if (!sl || sl === "None" || sl === "") return;
                if (locked[idx]) occupiedKeys.add(normalizeLoraKeyForDedupe(sl));
                else if (hasManualLoraSelection) return;
                else if (!kwManaged[idx]) occupiedKeys.add(normalizeLoraKeyForDedupe(sl));
            });

            const uniqueLoras = [];
            const seenLora = new Set();
            for (const a of activeAssignments) {
                const l = a.lora;
                if (!l || l === "None" || l === "") continue;
                const k = normalizeLoraKeyForDedupe(l);
                if (!k || seenLora.has(k)) continue;
                seenLora.add(k);
                if (occupiedKeys.has(k)) continue;
                uniqueLoras.push(l);
            }

            const slotEligible = (i) => {
                if (locked[i]) return false;
                if (hasManualLoraSelection) return true;
                const empty = !slots[i] || slots[i] === "None" || slots[i] === "";
                if (empty) return true;
                return kwManaged[i];
            };

            let uiChanged = false;
            let si = 0;
            for (let di = 0; di < uniqueLoras.length; di++) {
                while (si < 4 && !slotEligible(si)) si++;
                if (si >= 4) break;
                const rawPick = uniqueLoras[di];
                const resolved = resolveLoraPathForDropdown(rawPick, comfyLoraFiles) || rawPick;
                const curKey = slots[si] ? normalizeLoraKeyForDedupe(slots[si]) : "";
                const newKey = normalizeLoraKeyForDedupe(resolved);
                const empty = !slots[si] || slots[si] === "None" || slots[si] === "";
                if (curKey !== newKey || empty) {
                    slots[si] = resolved;
                    $(`#ig_lora_${si + 1}`).val(slots[si]);
                    uiChanged = true;
                }
                if (!kwManaged[si]) uiChanged = true;
                kwManaged[si] = true;
                si++;
            }

            const desiredKeysNormalized = new Set(
                uniqueLoras.map(l => normalizeLoraKeyForDedupe(resolveLoraPathForDropdown(l, comfyLoraFiles) || l)).filter(Boolean)
            );
            for (let i = 0; i < 4; i++) {
                if (locked[i]) continue;
                if (!hasManualLoraSelection && !kwManaged[i]) continue;
                const sk = slots[i] ? normalizeLoraKeyForDedupe(slots[i]) : "";
                if (!sk || !desiredKeysNormalized.has(sk)) {
                    if (slots[i]) {
                        slots[i] = "";
                        kwManaged[i] = false;
                        $(`#ig_lora_${i + 1}`).val("");
                        uiChanged = true;
                    }
                }
            }

            if (uiChanged) {
                s.selectedLora = slots[0];
                s.selectedLora2 = slots[1];
                s.selectedLora3 = slots[2];
                s.selectedLora4 = slots[3];
                s.selectedLoraWt = weights[0];
                s.selectedLoraWt2 = weights[1];
                s.selectedLoraWt3 = weights[2];
                s.selectedLoraWt4 = weights[3];
                saveProfileToMemory();
            }
        }

        let l1 = slots[0], l2 = slots[1], l3 = slots[2], l4 = slots[3];
        let w1 = weights[0], w2 = weights[1], w3 = weights[2], w4 = weights[3];
        finalPrompt = ensureSelectedVrtlIdentityPromptForLoras(finalPrompt, [l1, l2, l3, l4]);
        if (s.promptStyle === "zimage" && blockForbiddenZImagePrompt(finalPrompt)) return;

        const comfyRepl = {
            "%prompt%": finalPrompt,
            "%ai_text%": aiText,
            "%negative_prompt%": s.customNegative || "",
            "%seed%": finalSeed,
            "%sampler%": s.selectedSampler || "euler",
            "%scheduler%": s.selectedScheduler || "simple",
            "%model%": s.selectedModel || "v1-5-pruned.ckpt",
            "%steps%": parseInt(s.steps, 10) || 20,
            "%scale%": parseFloat(s.cfg) || 7.0,
            "%denoise%": parseFloat(s.denoise) || 1.0,
            "%clip_skip%": -Math.abs(parseInt(s.clipSkip, 10)) || -1,
            "%lora1%": l1 || "None",
            "%lora2%": l2 || "None",
            "%lora3%": l3 || "None",
            "%lora4%": l4 || "None",
            "%lorawt1%": w1,
            "%lorawt2%": w2,
            "%lorawt3%": w3,
            "%lorawt4%": w4,
            "%width%": parseInt(s.imgWidth, 10) || 512,
            "%height%": parseInt(s.imgHeight, 10) || 512,
        };
        const seedPlaceholderState = { injected: false };

        for (const nodeId in workflow) {
            const node = workflow[nodeId];
            if (node.inputs) {
                for (const key in node.inputs) {
                    node.inputs[key] = igSubstituteComfyPlaceholderDeep(node.inputs[key], comfyRepl, seedPlaceholderState);
                }
                if (!seedPlaceholderState.injected && node.class_type === "KSampler" && 'seed' in node.inputs && typeof node.inputs['seed'] === 'number') { node.inputs.seed = finalSeed; }
            }
        }

        igLastComfyApiRequest = igBuildLastComfyApiSnapshot(s, workflow, finalPrompt, aiText, finalSeed, l1, l2, l3, l4, w1, w2, w3, w4);
        igRefreshLastComfyApiPanel();

        if (isRunpodReady(s)) {
            try {
                await igGenerateWithRunpod(workflow, finalPrompt, target, s);
                if (!background) $("#kazuma_progress_overlay").hide();
            } catch (e) {
                if (!background) $("#kazuma_progress_overlay").hide();
                toastr.error("RunPod Error: " + e.message);
                throw e;
            }
            return;
        }
        if (ensureRunpodSettings(s).enabled) {
            if (!background) $("#kazuma_progress_overlay").hide();
            toastr.error("RunPod endpoint ID and API key are required.");
            throw new Error("RunPod endpoint ID and API key are required.");
        }

        try {
            const res = await fetch(`${s.comfyUrl}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow }) });
            if(!res.ok) throw new Error("Failed");
            const data = await res.json();

            if (!background) showKazumaProgress("Rendering Image...");
            const started = Date.now();
            const timeoutMs = 10 * 60 * 1000;
            while (Date.now() - started < timeoutMs) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                const historyRes = await fetch(`${s.comfyUrl}/history/${data.prompt_id}`);
                const h = await historyRes.json();
                if (!h[data.prompt_id]) continue;
                const generatedPrompt = igExtractComfyGeneratedPrompt(h[data.prompt_id], workflow);
                let finalImage = null;
                for (const nodeId in h[data.prompt_id].outputs) {
                    const nodeOut = h[data.prompt_id].outputs[nodeId];
                    if (nodeOut.images && nodeOut.images.length > 0) { finalImage = nodeOut.images[0]; break; }
                }
                if (!finalImage) throw new Error("ComfyUI completed without an image output.");
                if (!background) showKazumaProgress("Downloading...");
                const imgUrl = `${s.comfyUrl}/view?filename=${finalImage.filename}&subfolder=${finalImage.subfolder}&type=${finalImage.type}`;
                const response = await fetch(imgUrl);
                const base64Raw = await igReadBlobAsDataUrl(await response.blob());
                const { base64Clean, format } = await igMaybeCompressDataUrl(base64Raw, s);
                await igAttachGeneratedImage(base64Clean, generatedPrompt || finalPrompt, target, format);
                if (!background) $("#kazuma_progress_overlay").hide();
                return;
            }
            throw new Error("ComfyUI image job timed out.");
        } catch(e) {
            if (!background) $("#kazuma_progress_overlay").hide();
            toastr.error("Comfy Error: " + e.message);
            throw e;
        }
    }

    async function vgTestConnection() {
        try {
            const res = await fetch('/api/sd/comfy/ping', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: getLocalProfile().videoGen.comfyUrl }) });
            if (res.ok) toastr.success("ComfyUI Connected!");
            else throw new Error("Ping failed");
        } catch (e) {
            toastr.error("Connection Failed: " + e.message);
        }
    }

    function vgComfyImageName(uploadResult, fallbackName) {
        const name = uploadResult?.name || fallbackName || "";
        const subfolder = uploadResult?.subfolder || "";
        return subfolder ? `${subfolder}/${name}` : name;
    }

    function vgSetFrameImage(slot, imageName) {
        const s = getLocalProfile().videoGen;
        if (slot === "last") {
            s.lastFrameImage = imageName;
            $("#vg_last_frame").val(imageName);
        } else {
            s.firstFrameImage = imageName;
            $("#vg_first_frame").val(imageName);
        }
        saveProfileToMemory();
    }

    async function vgUploadBlobToComfy(blob, filename) {
        const s = getLocalProfile().videoGen;
        const form = new FormData();
        form.append("image", blob, filename || `megumin_frame_${Date.now()}.png`);
        form.append("type", "input");
        form.append("overwrite", "true");
        const res = await fetch(`${s.comfyUrl}/upload/image`, { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    }

    async function vgUploadFrameFile(file, slot) {
        if (!file) return;
        try {
            showKazumaProgress("Uploading Frame...");
            const result = await vgUploadBlobToComfy(file, file.name);
            const imageName = vgComfyImageName(result, file.name);
            vgSetFrameImage(slot, imageName);
            toastr.success(`${slot === "last" ? "Last" : "First"} frame uploaded.`);
        } catch (e) {
            toastr.error("Upload failed: " + e.message);
        } finally {
            $("#kazuma_progress_overlay").hide();
            $(`#vg_upload_${slot}_file`).val("");
        }
    }

    function vgResolveMediaUrl(rawUrl) {
        const url = String(rawUrl || "");
        if (!url) return "";
        if (/^(https?:|data:|blob:)/i.test(url)) return url;
        if (url.startsWith("/")) return url;
        return `/${url.replace(/^\/+/, "")}`;
    }

    function vgCollectGeneratedImageGallery() {
        const chat = getContext().chat || [];
        const items = [];
        chat.forEach((msg, msgIndex) => {
            const mediaList = msg?.extra?.media || [];
            mediaList.forEach((media, mediaIndex) => {
                if (!media || media.type !== "image" || !media.url) return;
                items.push({
                    url: vgResolveMediaUrl(media.url),
                    title: media.title || `${msg.name || "Image"} #${mediaIndex + 1}`,
                    source: media.source || "",
                    msgIndex,
                    mediaIndex
                });
            });
        });
        return items.reverse();
    }

    async function vgUploadGalleryImage(item, slot) {
        showKazumaProgress("Uploading Gallery Image...");
        const response = await fetch(item.url);
        if (!response.ok) throw new Error("Could not read selected image.");
        const blob = await response.blob();
        const cleanTitle = String(item.title || "gallery_frame").replace(/[^\w.-]+/g, "_").slice(0, 60);
        const ext = blob.type && blob.type.includes("jpeg") ? "jpg" : (blob.type && blob.type.includes("webp") ? "webp" : "png");
        const result = await vgUploadBlobToComfy(blob, `${cleanTitle || "gallery_frame"}_${Date.now()}.${ext}`);
        const imageName = vgComfyImageName(result, result?.name);
        vgSetFrameImage(slot, imageName);
    }

    async function vgOpenGalleryPicker(slot) {
        const items = vgCollectGeneratedImageGallery();
        if (items.length === 0) return toastr.warning("No image attachments found in the current chat gallery.");

        const $content = $(`
            <div style="display:flex; flex-direction:column; gap:12px; font-family: 'Inter', sans-serif; color: var(--text-main);">
                <div style="font-size:0.85rem; color: var(--text-muted);">Pick an image to upload into ComfyUI as the ${slot === "last" ? "last" : "first"} WAN frame.</div>
                <div class="vg-gallery-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; max-height: 520px; overflow-y:auto; padding-right: 4px;"></div>
            </div>
        `);
        const $grid = $content.find(".vg-gallery-grid");
        let selectedIndex = 0;
        items.forEach((item, idx) => {
            const sourceLabel = item.source === "generated" ? "Generated" : "Gallery";
            const $tile = $(`
                <button type="button" class="vg-gallery-tile" data-index="${idx}" style="display:flex; flex-direction:column; gap:6px; text-align:left; cursor:pointer; background: var(--bg-main); border: 1px solid ${idx === 0 ? "var(--gold)" : "var(--border-color)"}; border-radius: 8px; padding: 8px; color: var(--text-main);">
                    <img src="${psEscapeAttr(item.url)}" alt="" style="width:100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: 6px; background:#000;" />
                    <span style="font-size:0.68rem; color: var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${sourceLabel}</span>
                </button>
            `);
            $tile.on("click", function() {
                selectedIndex = parseInt($(this).attr("data-index"), 10) || 0;
                $grid.find(".vg-gallery-tile").css("border-color", "var(--border-color)");
                $(this).css("border-color", "var(--gold)");
            });
            $grid.append($tile);
        });

        const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Select Video Frame", { okButton: "Use Image", cancelButton: "Cancel", wide: true, large: true });
        if (!await popup.show()) return;

        try {
            await vgUploadGalleryImage(items[selectedIndex], slot);
            toastr.success(`${slot === "last" ? "Last" : "First"} frame selected.`);
        } catch (e) {
            toastr.error("Gallery import failed: " + e.message);
        } finally {
            $("#kazuma_progress_overlay").hide();
        }
    }

    function vgDateParts() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return {
            date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
            time: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
        };
    }

    function vgResolveOutputPrefix(rawPrefix) {
        const p = vgDateParts();
        const base = (rawPrefix && String(rawPrefix).trim()) ? String(rawPrefix).trim() : "video/%date%/%time%";
        return base.replace(/%date%/g, p.date).replace(/%time%/g, p.time);
    }

    async function vgLoadWorkflow(s) {
        const path = (s.workflowPath && String(s.workflowPath).trim()) ? String(s.workflowPath).trim() : "wan-api.json";
        const url = path.includes("/") || path.includes("\\") ? `${extensionFolderPath}/${path.replace(/\\/g, "/")}` : `${extensionFolderPath}/${path}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not load ${path}`);
        return await res.json();
    }

    function vgPatchNode(workflow, id, patcher) {
        const node = workflow && workflow[id];
        if (!node || !node.inputs) return;
        patcher(node.inputs, node);
    }

    function vgPatchWorkflow(workflow, promptText) {
        const s = getLocalProfile().videoGen;
        const finalSeedRaw = parseInt(s.customSeed, 10);
        const finalSeed = finalSeedRaw === -1 || isNaN(finalSeedRaw) ? Math.floor(Math.random() * 1000000000000000) : finalSeedRaw;
        const prefix = vgResolveOutputPrefix(s.outputPrefix);
        const firstFrame = String(s.firstFrameImage || "").trim();
        const lastFrame = String(s.lastFrameImage || "").trim();
        const useLastFrame = !!(s.useLastFrame && lastFrame);

        vgPatchNode(workflow, "2368", (i) => { i.value = promptText; });
        vgPatchNode(workflow, "2371", (i) => { i.value = s.customNegative || ""; });
        vgPatchNode(workflow, "23", (i) => { if (firstFrame) i.image = firstFrame; });
        vgPatchNode(workflow, "2509", (i) => { if (useLastFrame) i.image = lastFrame; });
        vgPatchNode(workflow, "1512:1670", (i) => { i.value = finalSeed; });
        vgPatchNode(workflow, "1512:1668", (i) => { i.value = parseInt(s.seconds, 10) || 5; });
        vgPatchNode(workflow, "1512:1669", (i) => { i.value = parseFloat(s.fps) || 16; });
        vgPatchNode(workflow, "1512:1671", (i) => {
            i.steps_total = parseInt(s.stepsTotal, 10) || 4;
            i.refiner_step = parseInt(s.refinerStep, 10) || 2;
            i.cfg = parseFloat(s.cfg) || 1;
            i.sampler_name = s.sampler || "euler";
            i.scheduler = s.scheduler || "linear_quadratic";
        });
        vgPatchNode(workflow, "1512:2210", (i) => {
            i.precision_presets = s.precisionPreset || "0.65 MP - Balanced";
            i.resolution_presets = s.resolutionPreset || "480p";
            i.aspect_preset = s.aspectPreset || "9:16 - Social";
            i.swap_aspect = !!s.swapAspect;
            i.scale_from_image = true;
            i.no_scale = false;
            i.mode = "WAN/LTX (Div32)";
        });
        vgPatchNode(workflow, "1512:2336", (i) => { i.value = !useLastFrame; });
        vgPatchNode(workflow, "28", (i) => {
            i.filename_prefix = prefix;
            i.format = s.outputFormat || "video/h265-mp4";
            i.crf = parseInt(s.crf, 10) || 22;
            i.save_output = true;
        });
        vgPatchNode(workflow, "2502", (i) => {
            i.filename_prefix = `${prefix}MINIMEME`;
            i.save_output = false;
        });
        vgPatchNode(workflow, "2503", (i) => { i.filename_prefix = `${prefix}LASTFRAME`; });
        vgPatchNode(workflow, "1512:2089", (i) => {
            i["resize_type.scale"] = parseFloat(s.upscaleMultiplier) || 2;
            i.quality = s.upscaleQuality || "ULTRA";
        });
        ["1512:2450", "1512:2457"].forEach(id => vgPatchNode(workflow, id, (i) => { i.enabled = !!s.enableUpscale; }));
        vgPatchNode(workflow, "18", (i) => {
            if (i.lora_1) {
                i.lora_1.on = !!s.enableSmoothLora;
                i.lora_1.strength = parseFloat(s.lowLoraStrength) || 0.8;
            }
        });
        vgPatchNode(workflow, "26", (i) => {
            if (i.lora_1) {
                i.lora_1.on = !!s.enableSmoothLora;
                i.lora_1.strength = parseFloat(s.highLoraStrength) || 0.8;
            }
        });

        return { workflow, finalSeed, prefix };
    }

    function vgFindMediaOutput(historyEntry) {
        const outputs = historyEntry?.outputs || {};
        for (const nodeId of Object.keys(outputs)) {
            const nodeOut = outputs[nodeId];
            const buckets = ["videos", "gifs", "animated", "images"];
            for (const key of buckets) {
                if (Array.isArray(nodeOut[key]) && nodeOut[key].length > 0) {
                    return { media: nodeOut[key][0], bucket: key };
                }
            }
        }
        return null;
    }

    function vgInferFormat(filename, bucket) {
        const ext = String(filename || "").split(".").pop().toLowerCase();
        if (ext) return ext;
        if (bucket === "gifs") return "gif";
        return "mp4";
    }

    async function vgAttachGeneratedMedia(mediaInfo, finalPrompt, promptId = "") {
        const s = getLocalProfile().videoGen;
        const media = mediaInfo.media;
        const url = `${s.comfyUrl}/view?filename=${encodeURIComponent(media.filename)}&subfolder=${encodeURIComponent(media.subfolder || "")}&type=${encodeURIComponent(media.type || "output")}`;
        const response = await fetch(url);
        const blob = await response.blob();
        const base64Raw = await new Promise((res) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(blob); });
        const format = vgInferFormat(media.filename, mediaInfo.bucket);
        const charName = getContext().characters[getContext().characterId]?.name || "User";
        let savedPath = url;
        try {
            savedPath = await saveBase64AsFile(base64Raw.split(',')[1], charName, `${charName}_video_${humanizedDateTime()}`, format);
        } catch (e) {
            console.warn(`[${extensionName}] Could not save video locally; attaching ComfyUI URL instead.`, e);
        }
        const isGif = format === "gif";
        const mediaAttach = {
            url: savedPath,
            type: isGif ? "image" : "video",
            source: "generated",
            title: finalPrompt,
            generation_type: "free"
        };
        const newMsg = { name: "Video Gen Kazuma", is_user: false, is_system: true, send_date: Date.now(), mes: "", extra: { media: [mediaAttach], media_display: "gallery", media_index: 0, megumin_video_prompt_id: promptId }, force_avatar: "img/five.png" };
        getContext().chat.push(newMsg);
        await saveChat();
        if (typeof addOneMessage === "function") addOneMessage(newMsg);
        else await reloadCurrentChat();
    }

    async function generateVideoPromptText() {
        const s = getLocalProfile().videoGen;
        const chat = getContext().chat || [];
        const lastMessages = chat.filter(m => !m.is_system).slice(-5).map(m => {
            const text = cleanMessageTextForKeywords(m.mes);
            return `${m.name}: ${text.trim()}`;
        }).join("\n\n");

        const styleMap = {
            cinematic: "Write a cinematic WAN image-to-video prompt in clear descriptive prose. Include subject, action, facial expression, environment, lighting, camera framing, and temporal motion.",
            anime: "Write an anime-focused WAN image-to-video prompt with concise visual tags and motion phrases. Keep it readable and comma-separated where useful.",
            realistic: "Write a realistic camera prompt for WAN image-to-video. Emphasize plausible body movement, lens feel, lighting continuity, and physical detail."
        };
        const motionMap = {
            smooth: "Motion should be smooth, natural, temporally consistent, and avoid abrupt camera movement.",
            subtle: "Motion should be subtle: breathing, blinking, small expression changes, cloth or hair movement, and a living-still feel.",
            dynamic: "Motion should be more active and readable while preserving anatomy and frame consistency.",
            locked: "Keep the camera locked or nearly locked; describe subject motion instead of camera motion."
        };

        activeVideoGenRequest = {
            chatText: lastMessages,
            styleStr: styleMap[s.promptStyle] || styleMap.cinematic,
            motionStr: motionMap[s.motionStyle] || motionMap.smooth,
            extraStr: s.promptExtra || "None"
        };

        try {
            const rawOutput = await generateQuietPrompt({ prompt: "___PS_VIDEO_GEN___" });
            return stripUtilityThinkingWrapper(rawOutput);
        } finally {
            activeVideoGenRequest = null;
        }
    }

    async function vgRenderPromptWithComfy(finalPrompt, allowPreview = true) {
        const s = getLocalProfile().videoGen;
        if (activeVideoGenJob) {
            toastr.warning("A video render is already running.");
            return false;
        }
        finalPrompt = stripUtilityThinkingWrapper(finalPrompt || "").trim();
        if (!finalPrompt) throw new Error("Video prompt was empty.");

        if (allowPreview && s.previewPrompt) {
            $("#kazuma_progress_overlay").hide();
            const $content = $(`
                <div style="display:flex; flex-direction:column; gap:10px; font-family: 'Inter', sans-serif;">
                    <div style="font-size: 0.85rem; color: var(--text-muted);">Review or modify the WAN prompt before it goes to ComfyUI.</div>
                    <textarea class="ps-modern-input vg-preview-textarea" style="height: 170px; resize: vertical; font-family: monospace; font-size: 0.85rem; padding: 10px;">${psEscapeText(finalPrompt)}</textarea>
                </div>
            `);
            let liveText = finalPrompt;
            $content.find(".vg-preview-textarea").on("input", function() { liveText = $(this).val(); });
            const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Preview Video Prompt", { okButton: "Send to ComfyUI", cancelButton: "Cancel", wide: true });
            if (!await popup.show()) {
                toastr.info("Generation cancelled.");
                return false;
            }
            finalPrompt = liveText.trim();
            if (!finalPrompt) {
                toastr.warning("Prompt cannot be empty.");
                return false;
            }
        }

        activeVideoGenJob = true;
        showKazumaProgress("Preparing WAN Workflow...");
        try {
            const rawWorkflow = await vgLoadWorkflow(s);
            const { workflow } = vgPatchWorkflow(rawWorkflow, finalPrompt);
            const res = await fetch(`${s.comfyUrl}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow }) });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            const promptId = data.prompt_id;

            showKazumaProgress("Rendering Video...");
            const checkInterval = setInterval(async () => {
                try {
                    const h = await (await fetch(`${s.comfyUrl}/history/${promptId}`)).json();
                    if (!h[promptId]) return;
                    clearInterval(checkInterval);
                    if (completedVideoPromptIds.has(promptId)) {
                        activeVideoGenJob = false;
                        $("#kazuma_progress_overlay").hide();
                        return;
                    }
                    completedVideoPromptIds.add(promptId);
                    const mediaInfo = vgFindMediaOutput(h[promptId]);
                    if (!mediaInfo) {
                        activeVideoGenJob = false;
                        $("#kazuma_progress_overlay").hide();
                        return toastr.warning("ComfyUI finished, but no video output was found.");
                    }
                    try {
                        showKazumaProgress("Downloading Video...");
                        await vgAttachGeneratedMedia(mediaInfo, finalPrompt, promptId);
                        toastr.success("Video inserted!");
                    } finally {
                        activeVideoGenJob = false;
                        $("#kazuma_progress_overlay").hide();
                    }
                } catch (e) {
                    activeVideoGenJob = false;
                    $("#kazuma_progress_overlay").hide();
                    console.warn(`[${extensionName}] Video poll failed`, e);
                }
            }, 1500);
            return true;
        } catch (e) {
            activeVideoGenJob = false;
            throw e;
        }
    }

    async function vgRenderManualPrompt() {
        const s = getLocalProfile()?.videoGen;
        if (!s || !s.enabled) return toastr.warning("Enable Video Generation first.");
        if (!String(s.firstFrameImage || "").trim()) return toastr.warning("First Frame Image is required for the WAN workflow.");
        const promptText = String($("#vg_manual_prompt").val() || s.manualPrompt || "").trim();
        if (!promptText) return toastr.warning("Manual prompt cannot be empty.");
        s.manualPrompt = promptText;
        saveProfileToMemory();

        showKazumaProgress("Preparing Manual Render...");
        try {
            await vgRenderPromptWithComfy(promptText, false);
        } catch (e) {
            console.error(e);
            $("#kazuma_progress_overlay").hide();
            toastr.error("Manual video render failed: " + e.message);
        }
    }

    async function vgManualGenerate() {
        const s = getLocalProfile()?.videoGen;
        if (!s || !s.enabled) return toastr.warning("Enable Video Generation first.");
        if (!String(s.firstFrameImage || "").trim()) return toastr.warning("First Frame Image is required for the WAN workflow.");

        showKazumaProgress("Writing Video Prompt...");
        try {
            let finalPrompt;
            if (s.generatorBackend === "direct") {
                finalPrompt = await generateVideoPromptText();
            } else {
                finalPrompt = null;
                await useMeguminEngine(async () => {
                    finalPrompt = await generateVideoPromptText();
                }, "Megumin Image");
            }

            await vgRenderPromptWithComfy(finalPrompt, true);
        } catch (e) {
            console.error(e);
            $("#kazuma_progress_overlay").hide();
            toastr.error("Video generation failed: " + e.message);
        } finally {
            activeVideoGenRequest = null;
        }
    }

    async function vgPreviewWorkflowClick() {
        try {
            const s = getLocalProfile().videoGen;
            const rawWorkflow = await vgLoadWorkflow(s);
            const { workflow } = vgPatchWorkflow(rawWorkflow, "PREVIEW_VIDEO_PROMPT");
            const $content = $(`<textarea class="ps-modern-input" spellcheck="false" style="height: 520px; resize: none; font-family: Consolas, Monaco, monospace; font-size: 12px; white-space: pre; background: #000;"></textarea>`);
            $content.val(JSON.stringify({ prompt: workflow }, null, 2));
            const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Patched WAN /prompt Payload", { okButton: "Close", cancelButton: "Close", wide: true, large: true });
            await popup.show();
        } catch (e) {
            toastr.error(e.message);
        }
    }

    // -------------------------------------------------------------
    // AI GENERATION & BAN LIST HELPER FUNCTIONS (RESTORED)
    // -------------------------------------------------------------
    const PS_BAD_STUFF_REGEX = /(<disclaimer>.*?<\/disclaimer>)|(<guifan>.*?<\/guifan>)|(<danmu>.*?<\/danmu>)|(<options>.*?<\/options>)|```start|```end|<done>|`<done>`|(.*?<\/(?:ksc??|think(?:ing)?)>(\n)?)|(<(?:ksc??|think(?:ing)?)>[\s\S]*?<\/(?:ksc??|think(?:ing)?)>(\n)?)/gs;

    function cleanMessageTextForKeywords(text) {
        if (!text) return "";
        let t = String(text);
        t = t.replace(PS_BAD_STUFF_REGEX, "");
        t = t.replace(/<think>[\s\S]*?<\/redacted_thinking>/gis, "");
        t = t.replace(/<details>[\s\S]*?<\/details>/gs, "");
        t = t.replace(/<summary>[\s\S]*?<\/summary>/gs, "");
        t = t.replace(/<[^>]+>/g, "");
        return t.trim();
    }

    /** Remove reasoning wrappers from utility-model outputs. Tag pairs vary by provider. */
    function stripUtilityThinkingWrapper(text) {
        if (text == null) return "";
        let s = String(text);
        s = s.replace(/<think>[\s\S]*?<\/redacted_thinking>/gis, "");
        s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gis, "");
        s = s.replace(/<think>[\s\S]*?<\/think>/gis, "");
        return s.trim();
    }

    /** Illustrious / Danbooru: drop plain-English planning before the first booru-style subject leader. */
    function stripPreambleBeforeBooruTags(text) {
        const t = String(text || "").trim();
        if (!t) return t;
        const anchor = /\b(1girl|2girls|3girls|1boy|2boys|3boys|multiple_girls|multiple_boys|solo|no_humans)\b\s*,/i;
        const m = t.match(anchor);
        if (m && m.index > 0) return t.slice(m.index).trim();
        return t;
    }

    function getRecentChatForLoraKeywords() {
        const context = getContext();
        if (!context.chat || context.chat.length === 0) return "";
        const chat = context.chat;
        const lastUser = [...chat].reverse().find(m => m.is_user && !m.is_system);
        const lastAi = [...chat].reverse().find(m => !m.is_user && !m.is_system);
        const parts = [];
        if (lastUser?.mes) parts.push(cleanMessageTextForKeywords(lastUser.mes));
        if (lastAi?.mes) parts.push(cleanMessageTextForKeywords(lastAi.mes));
        return parts.join("\n").toLowerCase();
    }

    function normalizeLoraKeyForDedupe(name) {
        if (!name || typeof name !== "string") return "";
        return name.replace(/\\/g, "/").trim().toLowerCase();
    }

    function ensureSelectedVrtlIdentityPrompt(prompt, s) {
        return ensureSelectedVrtlIdentityPromptForLoras(prompt, [s?.selectedLora, s?.selectedLora2, s?.selectedLora3, s?.selectedLora4]);
    }

    function ensureSelectedVrtlIdentityPromptForLoras(prompt, loraNames) {
        const required = [...new Map(
            (Array.isArray(loraNames) ? loraNames : [])
                .flatMap(name => getVrtlLoraIdentityKeywords(name) || [])
                .map(keyword => [keyword.toLowerCase(), keyword])
        ).values()];
        if (required.length === 0) return prompt;

        const current = String(prompt || "");
        const missing = required.filter(keyword => !current.toLowerCase().includes(keyword.toLowerCase()));
        return missing.length > 0 ? `${missing.join(', ')}, ${current}`.replace(/,\s*$/, "") : current;
    }

    function igSyncImageGenLoraFromDom(s) {
        if (!s) return;
        for (let i = 1; i <= 4; i++) {
            const $sel = $(`#ig_lora_${i}`);
            if (!$sel.length) continue;
            const key = i === 1 ? "selectedLora" : `selectedLora${i}`;
            const wtKey = i === 1 ? "selectedLoraWt" : `selectedLoraWt${i}`;
            const val = $sel.val();
            if (val !== undefined && val !== null) s[key] = val;
            const $wt = $(`#ig_lorawt_${i}`);
            if ($wt.length) {
                const w = parseFloat($wt.val());
                if (!isNaN(w)) s[wtKey] = w;
            }
        }
    }

    function getCleanedChatHistory() {
        const context = getContext();
        if (!context.chat || context.chat.length === 0) return "";

        const aiMessages = context.chat.filter(m => !m.is_user && !m.is_system).slice(-50);

        let cleanedMessages = aiMessages.map(m => cleanMessageTextForKeywords(m.mes));

        cleanedMessages = cleanedMessages.filter(t => t.length > 0);
        return cleanedMessages.join("\n\n");
    }



    function extendBaseDict(dict) {
        if (getLocalProfile().imageGen && getLocalProfile().imageGen.enabled) {
            const ig = getLocalProfile().imageGen;
            const backgroundAutomation = ensureBackgroundAutomationSettings(ig);
            let shouldInject = false;
            let conditionalText = "";
            const mode = ig.triggerMode || "always";
            const legacyInlineEnabled = !backgroundAutomation.autoEnabled && !backgroundAutomation.smartEnabled;

            if (!legacyInlineEnabled) shouldInject = false;
            else if (mode === "always") shouldInject = true;
            else if (mode === "frequency") {
                const chat = getContext().chat || [];
                const aiMsgCount = chat.filter(m => !m.is_user && !m.is_system).length;
                const freq = parseInt(ig.autoGenFreq) || 1;
                if ((aiMsgCount + 1) % freq === 0) shouldInject = true;
            } else if (mode === "conditional") {
                shouldInject = true;
                conditionalText = "CRITICAL INSTRUCTION: ONLY output the <img prompt=\"...\"> tag if the character is explicitly taking a photo, sending a picture, or sharing an image in this exact moment. If not, do NOT output the image tags at all.\n\n";
            }

            if (shouldInject) {
                const igLi = ig.loraIntel;
                const booruStd = isBooruStandardImageMode(ig, igLi);
                const charKeyImg = getCharacterKey() || "default";
                const allowStoredAppearanceGuidance = ig.promptStyle !== "zimage";
                const promptUsesCharacterGuidance = allowStoredAppearanceGuidance && shouldUseCharacterGuidance(ig, igLi) && getMatchedCharacterGuidance(igLi, charKeyImg).length > 0;

                const booruStableLead = buildBooruStandardTagLead(ig, igLi);
                const personaGuidance = buildPersonaImageGuidance(ig, booruStd);

                let styleStr = ig.promptStyle === "illustrious"
                    ? "Use Danbooru-style tags. Focus on anime."
                    : (ig.promptStyle === "zimage"
                        ? `Inside the <img prompt=\"\"> value: ${Z_IMAGE_PROMPT_INSTRUCTION}`
                        : (ig.promptStyle === "sdxl"
                            ? "Inside the <img prompt=\"\"> value: SDXL natural prose ONLY—fluent English in full sentences. FORBIDDEN: comma-separated tag dumps, Danbooru underscores, 1girl-style shorthand, lists of keywords. Translate any listed cues into description."
                            : "Use keywords."));
                if (booruStd) {
                    styleStr = "Inside the image prompt, write ONLY flowing natural-language (full sentences, not booru tag lists). Turn shorthand into prose—for example \"1girl, blue eyes, huge breasts\" → \"a woman with blue eyes and huge breasts.\" Describe actions and poses clearly. Do NOT repeat the opening tag block listed below; only the mandatory leading-tag prefix is supplied separately—your part is prose only. If Extra lists scene cues or character-appearance Danbooru tags below, weave them into that prose (translate to natural description; do not duplicate as a raw tag list).";
                } else if (isNaturalLanguageImageStyle(ig.promptStyle) && booruStableLead) {
                    styleStr += " Do NOT repeat the comma-separated mandatory leading-tag prefix listed below; your attribute value is prose only, after that prefix is applied by the pipeline.";
                }
                if (igLi && igLi.enabled && igLi.useDanbooruTags && !isNaturalLanguageImageStyle(ig.promptStyle) && !booruStd) {
                    styleStr += " For Anima, use lowercase tags with spaces instead of underscores, escape literal parentheses in known character/series tags (example: saber \\(fate\\)), and do not combine story character names with look-alike tags.";
                }
                const maxAnimaTags = getAnimaMaxTags(ig);
                if (maxAnimaTags && !isNaturalLanguageImageStyle(ig.promptStyle) && !booruStd) {
                    styleStr += ` Keep the complete prompt concise: output no more than ${maxAnimaTags} comma-separated tags total, prioritizing characters, action, pose, expression, camera, and setting.`;
                }
                styleStr += ` ${IMAGE_SCENE_FIDELITY_INSTRUCTION}`;
                if (ig.structuredPromptRules) {
                    styleStr += ` ${buildImagePromptStructureRules(ig, booruStd)}`;
                }
                let perspStr = ig.promptPerspective === "pov" ? "First-Person (POV)." : (ig.promptPerspective === "character" ? "Focus on character appearance." : "Describe environment.");

                let liInstructions = "";
                if (igLi && igLi.enabled) {
                    const li = igLi;
                    {
                        const useStableCharacterGuidance = promptUsesCharacterGuidance;
                        const activeAssignments = getActiveCharacterAssignments(li, charKeyImg);

                        if (activeAssignments.length > 0) {
                            const scope = $("#li_scope_select").val() || "global";
                            const activeList = scope === "character" && li.characterActiveLoras[charKeyImg] ? li.characterActiveLoras[charKeyImg] : li.globalActiveLoras;

                            let kwStrings = [];
                            let descStrings = [];
                            let booruStrings = [];

                            activeAssignments.forEach(a => {
                                if (li.ensureLoras && a.lora) {
                                    const loraEntry = activeList.find(l => l.name === a.lora);
                                    const keywords = getEffectiveLoraKeywords(loraEntry);
                                    if (keywords.length > 0) {
                                        kwStrings.push(`${a.character}: ${keywords.join(', ')}`);
                                    }
                                }
                                const tagBlock = allowStoredAppearanceGuidance ? (useStableCharacterGuidance ? getStableAssignmentTagBlock(a, li) : getAssignmentTagBlock(a, li)) : "";
                                if (allowStoredAppearanceGuidance && li.useDanbooruTags && tagBlock) {
                                    booruStrings.push(`${a.character}: ${tagBlock}`);
                                }
                                if (allowStoredAppearanceGuidance && li.useCharDescriptions && a.description) {
                                    descStrings.push(`${a.character}: ${a.description}`);
                                }
                            });

                            if (kwStrings.length > 0) {
                                liInstructions += `\nInclude these activation keywords for the following characters: ${kwStrings.join(' | ')}`;
                            }
                            if (useStableCharacterGuidance && booruStrings.length > 0) {
                                liInstructions += "\nUse the matched character references below only as stable appearance guidance for who is present. Derive actions, poses, expressions, temporary state, setting, and composition from the chat scene.";
                            }
                            if (booruStrings.length > 0) {
                                if (booruStd) {
                                    liInstructions += `\nCharacter appearance (per role); merge into your flowing prose naturally—do not paste as a comma tag block after the mandatory prefix: ${booruStrings.join(' | ')}`;
                                } else if (isNaturalLanguageImageStyle(ig.promptStyle)) {
                                    liInstructions += `\nCharacter cues (per role)—weave into English prose in the prompt value only; no underscore tokens or comma tag lists: ${booruStrings.join(' | ')}`;
                                } else {
                                    liInstructions += `\nCharacter appearance tags by role. Use these as Anima-style comma tags with spaces instead of underscores. Keep known character/series tags exact and escaped when they have parentheses. Do not combine story names with look-alike tags: ${booruStrings.join(' | ')}`;
                                }
                            }
                            if (descStrings.length > 0) {
                                liInstructions += `\nCharacter appearances: ${descStrings.join(' | ')}`;
                            }
                        }
                    }
                }
                if (personaGuidance) {
                    if (booruStd || isNaturalLanguageImageStyle(ig.promptStyle)) {
                        liInstructions += `\nPlayer character visibility: ${personaGuidance} Integrate this into the generated image description.`;
                    } else {
                        liInstructions += `\nPlayer character visibility: ${personaGuidance} Add concise Anima-style tags for this visible participant.`;
                    }
                }

                const peTrim = (ig.promptExtra && ig.promptExtra.trim()) ? ig.promptExtra.trim() : "";
                const extraLine = peTrim
                    ? (booruStd
                        ? `\nExtra (scene tags and cues—integrate into your flowing prose; translate shorthand to natural language; do not duplicate the mandatory leading-tag prefix):\n${peTrim}`
                        : (isNaturalLanguageImageStyle(ig.promptStyle)
                            ? `\nExtra (scene cues—translate into flowing English inside the prompt; no comma-tag or underscore fragments):\n${peTrim}`
                            : `\nExtra (tags / instructions to keep as comma-separated tags): ${peTrim}`))
                    : "";
                const tagLeadLine = booruStableLead
                    ? (isNaturalLanguageImageStyle(ig.promptStyle)
                        ? `\nReference leading tags (the app prepends these; do NOT paste them into the attribute—write prose only inside prompt=\"\"): ${booruStableLead}`
                        : `\nMandatory tag prefix (copy exactly at the start of the prompt value, then comma, then your prose): ${booruStableLead}`)
                    : "";

                const adultPrecisionLine = ig.adultTagPrecision ? `\n${IMAGE_ADULT_TAG_PRECISION_INSTRUCTION}` : "";
                const examplesLine = ig.includePromptExamples || ig.promptStyle === "zimage" ? `\nTemplate example: ${buildImagePromptExamples(ig, booruStd)}` : "";

                dict["[[img1]]"] = `[IMAGE GENERATION]\n${conditionalText}Style: ${styleStr}\nPerspective: ${perspStr}${extraLine}${tagLeadLine}${liInstructions}${adultPrecisionLine}${examplesLine}`;
                dict["[[img2]]"] = `<img prompt="prompt">`;
            } else {
                dict["[[img1]]"] = ""; dict["[[img2]]"] = "";
            }
        } else {
            dict["[[img1]]"] = ""; dict["[[img2]]"] = "";
        }


    }

    function handlePromptInjection(messages, disablePrefill) {
        // --- INJECT VIDEO GEN PROMPT ---
        if (activeVideoGenRequest) {
            messages.length = 0;
            messages.push({
                "role": "system",
                "content": "You are an expert AI video prompt engineer for WAN image-to-video workflows. Read the scene and output exactly ONE video generation prompt. Emphasize visible subject action, motion continuity, expression changes, environment motion, lighting continuity, and camera behavior. STRICTLY FORBIDDEN: apologies, preambles, plans, meta commentary, reasoning, bullet lists, XML, markdown, or chat references. Your entire reply must be nothing except the raw prompt text."
            });
            messages.push({
                "role": "user",
                "content": `Write a WAN video generation prompt for the latest scene in this chat history.\n\n<chat>\n${activeVideoGenRequest.chatText}\n</chat>\n\nStyle Constraint: ${activeVideoGenRequest.styleStr}\nMotion Constraint: ${activeVideoGenRequest.motionStr}\nExtra Details: ${activeVideoGenRequest.extraStr}\n\nOutput ONLY the raw prompt text. No other words before or after.`
            });
            if (!disablePrefill) {
                messages.push({
                    "role": "assistant",
                    "content": "Understood.\n"
                });
            }

            console.log(`[${extensionName}] Injected Video Gen array in memory.`);
            return true;
        }

        // --- INJECT IMAGE GEN PROMPT ---
        if (activeImageGenRequest) {
            const zImageOutputContract = activeImageGenRequest.isZImage
                ? " Z-IMAGE OUTPUT CONTRACT: Return exactly one finished image prompt and nothing else. Start directly with the image description. Do not analyze the chat, enumerate details, explain decisions, plan, draft, refine, repeat, or add text before or after the prompt."
                : "";
            messages.length = 0;
            messages.push({
                "role": "system",
                "content": `You are an expert AI image prompt engineer. Read the scene and output exactly ONE image prompt. Obey Style Constraint and Camera Perspective. ${IMAGE_SCENE_FIDELITY_INSTRUCTION} STRICTLY FORBIDDEN: apologies, preambles, plans, meta commentary (e.g. "I need to", "I'll craft"), reasoning, bullet lists, <thinking> or <think> blocks, XML, markdown, or chat references. Your entire reply must be nothing except the raw prompt text.${zImageOutputContract}`
            });
            messages.push({
                "role": "user",
                "content": `Write an image generation prompt for the latest scene in this chat history.\n\n<chat>\n${activeImageGenRequest.chatText}\n</chat>\n\nScene Fidelity Requirement: ${IMAGE_SCENE_FIDELITY_INSTRUCTION}\nStyle Constraint: ${activeImageGenRequest.styleStr}\nCamera Perspective: ${activeImageGenRequest.perspStr}\nExtra Details: ${activeImageGenRequest.extraStr}\n\nOutput ONLY the raw prompt text. No other words before or after.${zImageOutputContract}`
            });
        if (!disablePrefill && !activeImageGenRequest.isZImage) {
            messages.push({
                "role": "assistant",
                "content": "Understood.\n"
            });
        }

            console.log(`[${extensionName}] 🎯 Injected Image Gen array in memory.`);
            return true;
        }

        // --- INJECT LORA ASSIGNMENT PROMPT ---
        if (activeLoraAssignRequest) {
            messages.length = 0;

            let modeInstructions = "";
            let jsonFormat = `  {"character": "Name"`;
            const needsMatchKeywords = activeLoraAssignRequest.ensureLoras || activeLoraAssignRequest.useTags;

            if (needsMatchKeywords) {
                jsonFormat += `, "match_keywords": "Name, Nickname, Title"`;
            }
            if (activeLoraAssignRequest.ensureLoras) {
                jsonFormat += `, "lora": "exact_lora_filename.safetensors"`;
                modeInstructions += "PRIORITY: You MUST assign LoRAs to characters if they appear in the conversation. Use 'match_keywords' to list variations of their name so we can detect them later. ";
            }
            if (activeLoraAssignRequest.useTags) {
                jsonFormat += `, "character_tag": "known_character_tag_or_empty", "series_tag": "series_tag_or_empty", "physical_tags": "hair/eyes/body tags", "clothing_tags": "outfit/accessory tags", "plain_description": "natural language visual description"`;
                let booruInstr = "You MUST provide Danbooru-style tag fields for each character. Put stable look-alike identity tags in character_tag, series/franchise tags in series_tag, body/face/hair/eyes in physical_tags, and stable outfit/accessory details in clothing_tags. Also provide plain_description as a detailed natural-language visual description. ";
                if (activeLoraAssignRequest.ensureCharacterTag) {
                    booruInstr += "ADDITIONALLY: For EACH character, character_tag MUST contain a famous anime/game character tag from Danbooru that best matches their physical appearance (e.g. 'megumin_(konosuba)', 'asuka_langley_soryu', 'saber_(fate)'). Pick the closest visual match based on hair color, eye color, and body type. If no close match exists, pick ANY well-known character tag that roughly fits. ";
                }
                booruInstr += "Use 'match_keywords' to list name variations for keyword detection. ";
                modeInstructions += booruInstr;
            }
            if (activeLoraAssignRequest.useDescriptions) {
                jsonFormat += `, "description": "physical description here..."`;
                let style = activeLoraAssignRequest.descStyle === 'natural' ? "natural language (e.g. 'a tall woman with blonde hair')" : "danbooru tags (e.g. 'tall, blonde hair')";
                modeInstructions += `You MUST provide a physical appearance description for each character in ${style}. `;
            }
            jsonFormat += `}`;

            let loraSection = "";
            if (activeLoraAssignRequest.ensureLoras && activeLoraAssignRequest.hasLoras) {
                loraSection = `\n\n<available_loras>\n${activeLoraAssignRequest.loraList}\n</available_loras>`;
            }
            const cardContextParts = [];
            if (activeLoraAssignRequest.cardDescription) {
                cardContextParts.push(`<character_card_description>\n${activeLoraAssignRequest.cardDescription}\n</character_card_description>`);
            }
            if (activeLoraAssignRequest.firstMessage) {
                cardContextParts.push(`<first_message>\n${activeLoraAssignRequest.firstMessage}\n</first_message>`);
            }
            const cardContextSection = cardContextParts.length > 0 ? `\n\n<character_card_context>\n${cardContextParts.join('\n\n')}\n</character_card_context>` : "";

            messages.push({
                "role": "system",
                "content": `You are an expert at analyzing roleplay conversations and extracting character visual metadata for image generation. ${modeInstructions}`
            });
            messages.push({
                "role": "user",
                "content": `Analyze this conversation and extract visual metadata for the important characters.\n\n<chat>\n${activeLoraAssignRequest.chatText}\n</chat>${cardContextSection}${loraSection}\n\nReturn a JSON array with this exact format:\n[\n${jsonFormat}\n]\n\nRules:\n- Use the character card context only to improve names, aliases, first-message identity cues, match_keywords, and stable visual traits.\n- Prefer the actual chat for who is present.\n- Do not include temporary actions, pose, expression, state, setting, or composition in character metadata.\n- Do not invent extra currently-present characters only because they are mentioned in the card context.\n- Output ONLY the JSON array, no explanation`
            });
        if (!disablePrefill) {
            messages.push({
                "role": "assistant",
                "content": "[\n"
            });
        }
            console.log(`[${extensionName}] 🎯 Injected LoRA Assignment array in memory.`);
            return true;
        }


        return false;
    }

    async function handleMessageReceived() {
        const s = getLocalProfile()?.imageGen;
        if (!s || !s.enabled) return;

        const chat = getContext().chat;
        if (!chat || !chat.length) return;

        const lastMsg = chat[chat.length - 1];
        if (lastMsg.is_user || lastMsg.is_system) return;

        const imgRegex = /<img\s+prompt=["'](.*?)["']\s*\/?>/i;
        const match = lastMsg.mes.match(imgRegex);
        if (!match) return;

        const extractedPrompt = match[1];
        lastMsg.mes = lastMsg.mes.replace(imgRegex, "").trim();
        await saveChat();
        reloadCurrentChat();

        setTimeout(() => {
            toastr.info(isRunpodReady(s) ? "Image tag detected. Sending to RunPod..." : "Image tag detected. Sending to ComfyUI...");
            igGenerateWithComfy(extractedPrompt, null, { normalizeGeneratedPrompt: true });
        }, 500);
    }

    function refreshBackgroundQueueStatus() {
        const automation = ensureBackgroundAutomationSettings(getLocalProfile()?.imageGen || {});
        const state = automation.queuePaused ? "Paused" : (backgroundImageWorkerActive ? "Working" : "Idle");
        const label = `${state} · ${backgroundImageQueue.length} queued`;
        $("#ig_bg_queue_status").text(label);
    }

    function getBackgroundOrigin(message) {
        const chat = getContext().chat || [];
        const index = chat.indexOf(message);
        const revisionKey = getMessageRevisionKey(message, index);
        return {
            index,
            sendDate: message?.send_date || null,
            name: message?.name || "",
            revisionKey,
            originKey: `${getCharacterKey() || "default"}:${revisionKey}`
        };
    }

    function hashBackgroundText(text) {
        let hash = 2166136261;
        const value = String(text || "");
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function getMessageRevisionKey(message, index) {
        const swipe = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
        const textHash = hashBackgroundText(cleanMessageTextForKeywords(message?.mes || ""));
        return `${message?.send_date || index}:${index}:${swipe}:${textHash}`;
    }

    function setQwenStatus(text) {
        const s = getLocalProfile()?.imageGen;
        if (!s) return;
        const automation = ensureBackgroundAutomationSettings(s);
        automation.qwenStatus = String(text || "Idle");
        automation.qwenStatusAt = Date.now();
        $("#ig_bg_qwen_status").text(automation.qwenStatus);
        $("#ig_bg_qwen_status_compact").text(`Qwen: ${automation.qwenStatus}`).attr("title", automation.qwenStatus);
        saveProfileToMemory();
    }

    function resolveBackgroundOrigin(origin) {
        const chat = getContext().chat || [];
        let index = origin?.sendDate ? chat.findIndex(m => m?.send_date === origin.sendDate && m?.name === origin.name) : -1;
        if (index < 0 && Number.isInteger(origin?.index) && chat[origin.index]) index = origin.index;
        if (index < 0) return null;
        return { message: chat[index], element: $(`.mes[mesid="${index}"]`) };
    }

    function getSceneSnapshotForMessage(message) {
        const chat = getContext().chat || [];
        if (!chat.length) return "";
        const foundIndex = chat.indexOf(message);
        const index = foundIndex >= 0 ? foundIndex : chat.length - 1;
        return chat.slice(Math.max(0, index - 4), index + 1)
            .filter(m => !m.is_system)
            .map(m => `${m.name}: ${cleanMessageTextForKeywords(m.mes).trim()}`)
            .filter(Boolean)
            .join("\n\n");
    }

    function getLatestVisualSceneText(message = null) {
        const chat = getContext().chat || [];
        const target = message || [...chat].reverse().find(m => !m.is_user && !m.is_system);
        return cleanMessageTextForKeywords(target?.mes || "");
    }

    function isExplicitSceneText(text) {
        return /\b(?:sex|fucking|fuck(?:s|ed|ing)?|penetrat(?:e|es|ed|ing|ion)|missionary|cowgirl|doggy|doggystyle|oral|blowjob|deepthroat|cunnilingus|handjob|fingering|anal|cum|ejaculat(?:e|es|ed|ing|ion)|orgasm|naked|nude|erection|cock|penis|pussy|vagina|breasts?|nipples?|thrust(?:s|ed|ing)?|grind(?:s|ing)?|masturbat(?:e|es|ed|ing|ion))\b/i.test(String(text || ""));
    }

    function shouldAutoGenerateScene(text, automation) {
        if (findZImageForbiddenMinorTerm(text)) return false;
        const explicit = isExplicitSceneText(text);
        const mode = automation.autoTriggerMode || "explicit";
        const triggerMatch = mode === "both" || (mode === "explicit" && explicit) || (mode === "normal" && !explicit);
        const chance = Math.max(0, Math.min(100, parseInt(automation.autoRandomChance, 10) || 0));
        const randomMatch = chance > 0 && Math.random() * 100 < chance;
        return mode === "random" ? randomMatch : (triggerMatch || randomMatch);
    }

    function detectPositionPresetFromScene(text) {
        const normalized = String(text || "").toLowerCase().replace(/[_-]+/g, " ");
        const aliases = [
            ["reverse cowgirl", "Reverse Cowgirl"],
            ["mating press", "Mating Press"],
            ["legs over shoulders", "Legs Over Shoulders"],
            ["against the wall", "Against Wall"],
            ["doggy style", "Doggy Style"],
            ["doggystyle", "Doggy Style"],
            ["deepthroat", "Deepthroat"],
            ["face sitting", "Face Sitting"],
            ["facesitting", "Face Sitting"],
            ["cunnilingus", "Cunnilingus"],
            ["blowjob", "Blowjob"],
            ["handjob", "Handjob"],
            ["footjob", "Footjob"],
            ["fingering", "Fingering"],
            ["missionary", "Missionary"],
            ["cowgirl", "Cowgirl"],
            ["spooning", "Spooning"],
            ["lotus", "Lotus"],
            ["standing oral", "Standing Oral"],
            ["69", "Oral 69"],
            ["anal", "Anal"],
            ["threesome", "Threesome"],
            ["double penetration", "Double Penetration"],
            ["paizuri", "Paizuri POV"],
            ["titfuck", "Titfuck"],
            ["grinding", "Grinding"],
            ["lap dance", "Lap Dance"]
        ];
        for (const [needle, label] of aliases) {
            if (normalized.includes(needle)) return NSFW_POSITION_PRESETS.find(p => p.label === label) || null;
        }
        if (/\b(?:mouth|lips?|tongue|throat)\b[\s\S]{0,100}\b(?:cock|penis|shaft|head|tip)\b|\b(?:cock|penis|shaft)\b[\s\S]{0,100}\b(?:mouth|lips?|tongue|throat|suck(?:s|ed|ing)?)\b/.test(normalized)) {
            return NSFW_POSITION_PRESETS.find(p => p.label === "Blowjob") || null;
        }
        if (/\b(?:penetrat(?:e|es|ed|ing|ion)|thrust(?:s|ed|ing)?|fucking|sex)\b/.test(normalized)) {
            return NSFW_POSITION_PRESETS.find(p => p.label === "Missionary") || null;
        }
        return null;
    }

    function extractDeterministicSceneTags(sceneText) {
        const text = String(sceneText || "").toLowerCase();
        const tags = [];
        const add = (condition, ...values) => { if (condition) tags.push(...values); };
        add(/\bbed(?:room)?\b/.test(text), "bedroom", "on bed");
        add(/\b(?:bath|shower|bathroom)\b/.test(text), "bathroom");
        add(/\b(?:pool|hot tub|jacuzzi)\b/.test(text), "poolside");
        add(/\b(?:kitchen)\b/.test(text), "kitchen");
        add(/\b(?:office|desk)\b/.test(text), "office");
        add(/\b(?:fitting room|changing room|dressing room)\b/.test(text), "fitting room", "fluorescent lighting");
        add(/\b(?:car|vehicle)\b/.test(text), "car interior");
        add(/\b(?:forest|woods)\b/.test(text), "forest");
        add(/\b(?:beach|shore)\b/.test(text), "beach");
        add(/\b(?:night|darkness|moonlight)\b/.test(text), "night", "dim lighting");
        add(/\b(?:sunlight|daylight|morning)\b/.test(text), "natural light");
        add(/\b(?:naked|nude|undressed)\b/.test(text), "nude");
        add(/\btopless\b/.test(text), "topless", "exposed breasts");
        add(/\b(?:underwear|lingerie|panties|bra)\b/.test(text), "lingerie");
        add(/\b(?:sweat|sweaty)\b/.test(text), "sweat");
        add(/\b(?:blush|blushing|flushed)\b/.test(text), "blush", "flushed face");
        add(/\b(?:moan|moaning)\b/.test(text), "moaning", "open mouth");
        add(/\b(?:cum|ejaculat(?:e|es|ed|ing|ion))\b/.test(text), "cum", "ejaculation");
        add(/\b(?:pov|first person)\b/.test(text), "pov");
        return [...new Set(tags)];
    }

    function applyDeterministicSceneOverride(analysis, sceneText, knownNames) {
        const position = detectPositionPresetFromScene(sceneText);
        if (!position && !isExplicitSceneText(sceneText)) return analysis;
        const normalized = String(sceneText || "").toLowerCase();
        const matchedNames = knownNames.filter(name => normalized.includes(String(name || "").toLowerCase()));
        const sceneTags = extractDeterministicSceneTags(sceneText);
        return {
            ...analysis,
            trigger: true,
            sceneType: "explicit",
            position: position?.label || analysis.position || "explicit sex",
            location: analysis.location || sceneTags.find(tag => /room|office|bedroom|bathroom|pool|beach|forest|kitchen|car/.test(tag)) || "",
            characters: analysis.characters?.length ? analysis.characters : matchedNames,
            query: analysis.query || [position?.label, ...matchedNames, ...sceneTags].filter(Boolean).join(", "),
            confidence: Math.max(Number(analysis.confidence) || 0, 1)
        };
    }

    function getDeterministicSceneAssignments(s, sceneText, preferredAssignments = null) {
        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        if (Array.isArray(preferredAssignments) && preferredAssignments.length) {
            return preferredAssignments.map(ensureStructuredCharacterAssignment).filter(a => !a.neverInclude);
        }
        const all = getModeCharacterAssignments(li, charKey).map(ensureStructuredCharacterAssignment).filter(a => !a.neverInclude);
        const normalized = String(sceneText || "").toLowerCase();
        const matched = all.filter(a => a.alwaysInclude || assignmentMatchesRecentChat(a, normalized, all.length <= 1));
        return matched.length ? matched : (all.length === 1 ? all : []);
    }

    function buildDeterministicBackgroundPrompt(s, sceneText, options = {}) {
        const assignments = getDeterministicSceneAssignments(s, sceneText, options.assignments);
        const position = options.position || detectPositionPresetFromScene(sceneText);
        const explicit = options.sceneType === "explicit" || isExplicitSceneText(sceneText) || !!position;
        const sceneTags = extractDeterministicSceneTags(sceneText);
        const loras = assignments.map(a => a.lora).filter(Boolean);
        const identityTriggers = loras.flatMap(lora => getVrtlLoraIdentityKeywords(lora) || []);
        const characterTags = assignments.flatMap(a => getAssignmentTagParts(a, s.loraIntel)).filter(Boolean);
        const femaleCount = assignments.filter(a => inferAssignmentSex(a) === "female").length;
        const maleCount = assignments.filter(a => inferAssignmentSex(a) === "male").length;
        const userSex = String(getLocalProfile()?.userPronouns || "").toLowerCase();
        let girls = femaleCount;
        let boys = maleCount;
        if (explicit && girls + boys < 2) {
            if (userSex === "female") girls++;
            else boys++;
        }
        if (explicit && girls === 0) girls = 1;
        if (explicit && boys === 0) boys = 1;
        const countTags = [
            girls > 0 ? `${girls}girl${girls > 1 ? "s" : ""}` : "",
            boys > 0 ? `${boys}boy${boys > 1 ? "s" : ""}` : ""
        ].filter(Boolean);
        const positionStaging = position ? getBatchPositionStaging(position.label, position.prompt) : "";
        const anatomySetting = ensureBackgroundAutomationSettings(s).batchMaleAnatomy || "standard";
        const anatomy = explicit && batchPositionUsesPenis(position?.label || "")
            ? (anatomySetting === "huge" ? "huge penis" : (anatomySetting === "large" ? "large penis" : "erect penis"))
            : "";
        const baseTags = [
            buildBooruStandardTagLead(s, s.loraIntel),
            s.promptExtra,
            ...countTags,
            explicit ? "hetero, sex, nude, uncensored" : "",
            anatomy,
            ...identityTriggers,
            ...characterTags,
            positionStaging,
            ...sceneTags
        ].filter(Boolean);

        if (!isNaturalLanguageImageStyle(s.promptStyle)) {
            return normalizeGeneratedTagField(baseTags.join(", "));
        }

        const people = assignments.map(a => {
            const identity = getVrtlLoraIdentityKeywords(a.lora);
            const appearance = getPlainAssignmentText(a) || getAssignmentTagBlock(a, s.loraIntel);
            return [a.character, identity?.join(", "), appearance].filter(Boolean).join(": ");
        }).filter(Boolean).join(" | ");
        const participantText = explicit
            ? `${girls} adult ${girls === 1 ? "woman" : "women"} and ${boys} adult ${boys === 1 ? "man" : "men"}`
            : `${Math.max(1, assignments.length)} adult character${assignments.length === 1 ? "" : "s"}`;
        return [
            `A clear image of ${participantText}.`,
            people ? `Character identities and appearance: ${people}.` : "",
            positionStaging ? `They are performing this exact action: ${positionStaging}.` : "",
            anatomy ? `The adult male has a visibly ${anatomy}.` : "",
            sceneTags.length ? `Visible scene details: ${sceneTags.join(", ")}.` : "",
            s.promptExtra ? `Additional visual cues: ${s.promptExtra}.` : ""
        ].filter(Boolean).join(" ");
    }

    function parseQwenJson(raw) {
        const text = String(raw || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("Qwen returned no JSON object.");
        const parsed = JSON.parse(match[0]);
        return {
            trigger: parsed.trigger === true,
            sceneType: String(parsed.sceneType || parsed.scene_type || "normal").toLowerCase(),
            characters: Array.isArray(parsed.characters) ? parsed.characters.map(String) : [],
            position: String(parsed.position || parsed.action || "").trim(),
            location: String(parsed.location || "").trim(),
            clothing: String(parsed.clothing || "").trim(),
            query: String(parsed.query || "").trim(),
            confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
        };
    }

    async function classifySceneWithLocalQwen(sceneText, knownCharacters, automation) {
        if (!automation.qwenUrl) throw new Error("Set the local Qwen endpoint URL first.");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(5000, parseInt(automation.qwenTimeoutMs, 10) || 30000));
        const system = `You are a tiny scene router for a local roleplay image system. Analyze only the supplied text. Return exactly one compact JSON object with keys trigger, sceneType, characters, position, location, clothing, query, confidence. trigger means a still image would usefully represent the latest visible moment. sceneType must be normal, romantic, or explicit. Use only character names from the supplied known-character list. If any participant may be under 18, set trigger false and confidence 1. Never add commentary.`;
        try {
            const response = await fetch(automation.qwenUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({
                    model: automation.qwenModel || "Qwen2-0.5B-Instruct",
                    temperature: 0,
                    max_tokens: 180,
                    messages: [
                        { role: "system", content: system },
                        { role: "user", content: `Known characters: ${knownCharacters.join(", ") || "none"}\n\nLatest RP scene:\n${sceneText}` }
                    ]
                })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const raw = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.message?.content ?? data?.response;
            return parseQwenJson(raw);
        } catch (e) {
            if (e?.name === "AbortError") throw new Error("Qwen request timed out.");
            throw e;
        } finally {
            clearTimeout(timeout);
        }
    }

    function findBestLibraryImage(analysis, automation) {
        const wantedChars = analysis.characters.map(v => v.toLowerCase());
        const wantedPosition = analysis.position.toLowerCase();
        const wantedLocation = analysis.location.toLowerCase();
        let best = null;
        let bestScore = 0;
        for (const item of automation.library) {
            let score = 0;
            const itemChars = Array.isArray(item.characters) ? item.characters.map(v => String(v).toLowerCase()) : [];
            for (const name of wantedChars) if (itemChars.includes(name)) score += 3;
            if (wantedPosition && String(item.position || "").toLowerCase().includes(wantedPosition)) score += 5;
            if (wantedLocation && String(item.location || "").toLowerCase().includes(wantedLocation)) score += 2;
            if (analysis.sceneType && String(item.sceneType || "").toLowerCase() === analysis.sceneType) score += 1;
            if (score > bestScore) { best = item; bestScore = score; }
        }
        return bestScore >= 3 ? best : null;
    }

    function enqueueBackgroundImageJob(job) {
        if (job.originKey && backgroundOriginKeys.has(job.originKey)) return false;
        if (job.originKey) backgroundOriginKeys.add(job.originKey);
        if (job.priority === "batch") backgroundImageQueue.push(job);
        else backgroundImageQueue.unshift(job);
        refreshBackgroundQueueStatus();
        processBackgroundImageQueue();
        return true;
    }

    function buildComfyNanoPromptContext(s, sceneText, manualScene = null) {
        const normalizedScene = normalizeManualImageScene(manualScene);
        const assignments = normalizedScene.assignments.length
            ? normalizedScene.assignments
            : getDeterministicSceneAssignments(s, sceneText);
        const identityTriggers = assignments
            .flatMap(a => getVrtlLoraIdentityKeywords(a.lora) || [])
            .filter(Boolean);
        const characterTags = assignments
            .flatMap(a => getAssignmentTagParts(a, s.loraIntel))
            .filter(Boolean);
        const selectedActionTags = normalizedScene.positions
            .map(position => getBatchPositionStaging(position.label, position.prompt))
            .filter(Boolean);
        const configuredTags = normalizeGeneratedTagField([
            buildBooruStandardTagLead(s, s.loraIntel),
            s.promptExtra,
            ...identityTriggers,
            ...characterTags,
            ...selectedActionTags
        ].filter(Boolean).join(", "));
        const selectedActionInstruction = selectedActionTags.length
            ? `Explicit user-selected action override:\n${selectedActionTags.join(", ")}`
            : "";

        return {
            fallbackPrompt: configuredTags || "roleplay scene image",
            aiText: [
                "Create one finished image-generation prompt for the latest visible roleplay moment.",
                "Infer the action, pose, anatomy/contact, clothing state, location, lighting, expression, and camera composition directly from the roleplay scene. Do not use or invent a deterministic action classification.",
                "The configured tags below are persistent user/character/LoRA guidance. Preserve identities and LoRA triggers, but do not treat appearance or style tags as evidence for what action is occurring.",
                selectedActionInstruction,
                `Roleplay scene:\n${String(sceneText || "").trim()}`,
                configuredTags ? `Configured UI, character, and LoRA tags:\n${configuredTags}` : "",
                "Return only the final image-generation prompt with no explanation."
            ].filter(Boolean).join("\n\n")
        };
    }

    function buildBackgroundAiText(job) {
        const source = String(job?.sceneText || "").trim();
        const required = String(job?.directPrompt || "").trim();
        const position = String(job?.metadata?.position || "").trim();
        const sceneType = String(job?.metadata?.sceneType || "").trim();
        return [
            "Create one finished image-generation prompt from the following source.",
            "Hard constraints: preserve exact character identities and LoRA triggers, participant counts, the detected adult action/position, and explicit anatomy/contact when present.",
            "The fallback visual prompt is guidance, not a list of mandatory tags. Treat location, clothing, lighting, expression, atmosphere, and camera terms as soft scene evidence. Keep only details supported by the latest scene, reconcile contradictions, and discard stale context.",
            "Return only the final prompt with no explanation.",
            sceneType ? `Scene type: ${sceneType}` : "",
            position ? `Required position/action: ${position}` : "",
            source ? `Roleplay scene:\n${source}` : "",
            required ? `Deterministic fallback and visual cues:\n${required}` : "",
        ].filter(Boolean).join("\n\n");
    }

    async function processBackgroundImageQueue() {
        if (backgroundImageWorkerActive) return;
        const initialAutomation = ensureBackgroundAutomationSettings(getLocalProfile()?.imageGen || {});
        if (initialAutomation.queuePaused) {
            refreshBackgroundQueueStatus();
            return;
        }
        backgroundImageWorkerActive = true;
        refreshBackgroundQueueStatus();
        while (backgroundImageQueue.length > 0) {
            const automation = ensureBackgroundAutomationSettings(getLocalProfile()?.imageGen || {});
            if (automation.queuePaused) break;
            const job = backgroundImageQueue.shift();
            backgroundActiveJob = job;
            refreshBackgroundQueueStatus();
            try {
                const s = getLocalProfile()?.imageGen;
                if (!s?.enabled) throw new Error("Image Generation was disabled.");
                if (!job.directPrompt) throw new Error("Background jobs require a deterministic direct prompt.");
                const gen = { prompt: job.directPrompt, skipLeadPrefix: false };
                const target = job.libraryOnly
                    ? { libraryOnly: true, background: true, metadata: job.metadata }
                    : { ...(resolveBackgroundOrigin(job.origin) || {}), background: true, metadata: job.metadata };
                if (!job.libraryOnly && !target.message) throw new Error("The originating RP message no longer exists.");
                await igGenerateWithComfy(gen.prompt, target, {
                    skipLeadPrefix: !!gen.skipLeadPrefix,
                    manualScene: job.manualScene,
                    background: true,
                    aiText: job.aiText || buildBackgroundAiText(job)
                });
            } catch (e) {
                console.error("[Megumin Suite] Background image job failed:", e);
            } finally {
                if (job.originKey) backgroundOriginKeys.delete(job.originKey);
                backgroundActiveJob = null;
            }
        }
        backgroundImageWorkerActive = false;
        refreshBackgroundQueueStatus();
    }

    function inferAssignmentSex(assignment) {
        const text = [
            assignment?.character,
            assignment?.character_tag,
            assignment?.physical_tags,
            assignment?.booru_tags,
            assignment?.plain_description,
            assignment?.description
        ].filter(Boolean).join(" ").toLowerCase().replace(/[_-]+/g, " ");
        if (/\b(?:1girl|woman|female|girl|lady|she|her|breasts?|pussy|vagina)\b/.test(text)) return "female";
        if (/\b(?:1boy|man|male|guy|he|him|penis|cock)\b/.test(text)) return "male";
        return "unknown";
    }

    function assignmentHasMinorWording(assignment) {
        const text = [
            assignment?.character,
            assignment?.character_tag,
            assignment?.physical_tags,
            assignment?.clothing_tags,
            assignment?.booru_tags,
            assignment?.plain_description,
            assignment?.description
        ].filter(Boolean).join(" ");
        return !!findZImageForbiddenMinorTerm(text);
    }

    function getBatchPositionStaging(positionName, positionPrompt) {
        const key = String(positionName || "").toLowerCase();
        const vaginal = "vaginal penetration, penis visibly entering vagina, connected bodies";
        const anal = "anal penetration, penis visibly entering anus, connected bodies";
        if (key === "missionary") return `${positionPrompt}, ${vaginal}, adult man above or between the adult woman's spread legs`;
        if (key === "cowgirl") return `${positionPrompt}, ${vaginal}, adult woman riding the adult man`;
        if (key === "reverse cowgirl") return `${positionPrompt}, ${vaginal}, adult woman riding while facing away`;
        if (["doggy style", "spooning", "standing", "against wall", "legs over shoulders", "mating press"].includes(key)) return `${positionPrompt}, ${vaginal}`;
        if (key === "anal") return `${positionPrompt}, ${anal}`;
        if (key === "blowjob" || key === "deepthroat" || key === "standing oral") return `${positionPrompt}, visible erect penis in mouth, clear oral contact`;
        if (key === "titfuck" || key === "paizuri pov") return `${positionPrompt}, visible erect penis between breasts`;
        if (key === "handjob") return `${positionPrompt}, visible erect penis held in hand`;
        if (key === "footjob") return `${positionPrompt}, visible erect penis between feet`;
        if (key === "oral 69") return `${positionPrompt}, two adult partners giving mutual oral sex with explicit genital contact`;
        if (key === "cunnilingus") return `${positionPrompt}, adult partner's mouth visibly contacting the adult woman's vulva`;
        if (key === "face sitting" || key === "riding face") return `${positionPrompt}, adult woman's vulva visibly pressed to the partner's mouth`;
        if (key === "fingering") return `${positionPrompt}, fingers visibly inside or spreading the adult woman's vagina`;
        if (key === "double penetration") return `${positionPrompt}, one adult woman and two adult men, simultaneous vaginal and anal penetration, two visible erect penises`;
        if (key === "threesome") return `${positionPrompt}, three adults, one adult woman and two adult men, explicit shared sexual contact`;
        return positionPrompt;
    }

    function batchPositionUsesPenis(positionName) {
        return !["cunnilingus", "face sitting", "riding face", "fingering", "grinding", "lap dance"].includes(String(positionName || "").toLowerCase());
    }

    function buildBatchScenePlan(primary, assignments, positionName, positionPrompt, s, automation) {
        const primarySex = inferAssignmentSex(primary);
        const preferredPartnerSex = primarySex === "male" ? "female" : "male";
        const partner = assignments.find(a => a !== primary && inferAssignmentSex(a) === preferredPartnerSex);
        const isThreePerson = /^(double penetration|threesome)$/i.test(positionName);
        const manualAssignments = [primary];
        if (partner) manualAssignments.push(partner);

        const primaryName = primary.character || "the selected adult character";
        const partnerName = partner?.character || (preferredPartnerSex === "female" ? "a generic adult woman" : "a generic adult man");
        const characters = [primaryName, partnerName];
        let castDescription;
        if (isThreePerson) {
            castDescription = primarySex === "male"
                ? `${primaryName}, ${partnerName}, and one additional generic adult man`
                : `${primaryName}, ${partnerName}, and one additional generic adult man`;
            characters.push("generic adult man");
        } else {
            castDescription = `${primaryName} and ${partnerName}`;
        }

        const staging = getBatchPositionStaging(positionName, positionPrompt);
        const anatomySetting = automation.batchMaleAnatomy || "standard";
        const anatomy = batchPositionUsesPenis(positionName)
            ? (anatomySetting === "huge" ? "huge penis" : (anatomySetting === "large" ? "large penis" : "clearly visible erect penis"))
            : "";
        const anatomyProse = anatomySetting === "huge"
            ? "The adult male has a huge, fully visible erect penis."
            : (anatomySetting === "large"
                ? "The adult male has a large, fully visible erect penis."
                : "The adult male's erect penis is clearly visible.");
        const naturalLanguage = isNaturalLanguageImageStyle(s.promptStyle);
        const castInstruction = naturalLanguage
            ? `Depict exactly ${isThreePerson ? "three" : "two"} consenting adults: ${castDescription}. Describe every person and the explicit anatomy/contact in fluent prose. Do not use shorthand such as 1girl or 1boy.`
            : `Mandatory cast and anatomy tags: ${isThreePerson ? "1girl, 2boys" : (primarySex === "male" ? "1boy, 1girl" : "1girl, 1boy")}, hetero, sex, nude, uncensored${anatomy ? `, ${anatomy}` : ""}.`;
        const extraInstruction = `Batch-library render. ${castInstruction} Selected adult character focus: ${primaryName}. Exact act staging: ${staging}${anatomy && naturalLanguage ? `. ${anatomyProse}` : "."} Keep analyzed character identities stable. Do not omit the partner, crop away the required contact, replace penetration with posing, or turn this into a solo pinup.`;
        const selectedAssignments = manualAssignments;
        let directPrompt;
        if (naturalLanguage) {
            const identities = selectedAssignments.map(a => {
                const vrtl = getVrtlLoraIdentityKeywords(a.lora);
                if (vrtl?.length) return `${a.character}: ${vrtl.join(", ")}`;
                const description = a.plain_description || a.description || getAssignmentTagBlock(a, s.loraIntel);
                return description ? `${a.character}: ${description}` : a.character;
            }).filter(Boolean).join(" | ");
            directPrompt = `${extraInstruction}${identities ? ` Character identity references: ${identities}.` : ""}`;
        } else {
            const characterTags = selectedAssignments.flatMap(a => getAssignmentTagParts(a, s.loraIntel)).filter(Boolean);
            const castTags = isThreePerson ? ["1girl", "2boys"] : (primarySex === "male" ? ["1boy", "1girl"] : ["1girl", "1boy"]);
            directPrompt = [
                ...castTags,
                "hetero",
                "sex",
                "nude",
                "uncensored",
                anatomy,
                ...characterTags,
                staging
            ].filter(Boolean).join(", ");
        }

        return {
            manualScene: { assignments: manualAssignments, positions: [{ label: positionName, prompt: staging }] },
            sceneText: `${castDescription}, all explicitly adult and consenting, performing this exact act: ${staging}.`,
            extraInstruction,
            directPrompt,
            characters
        };
    }

    function queueBatchCategoryJobs(characterName, positionName, requestedCount, addMore = false) {
        const s = getLocalProfile()?.imageGen;
        const automation = ensureBackgroundAutomationSettings(s);
        if (!automation.batchEnabled) throw new Error("Enable Batch Library Generator first.");
        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        const assignments = getModeCharacterAssignments(li, charKey).map(ensureStructuredCharacterAssignment).filter(a => !a.neverInclude && !assignmentHasMinorWording(a));
        if (!assignments.length) throw new Error("Analyze characters before starting a batch.");
        const assignment = assignments.find(a => String(a.character || "").toLowerCase() === String(characterName || "").toLowerCase());
        if (!assignment) throw new Error(`Analyzed character not found: ${characterName}`);
        const preset = NSFW_POSITION_PRESETS.find(p => p.label.toLowerCase() === String(positionName || "").toLowerCase());
        const positionPrompt = preset?.prompt || positionName;
        const groupKey = `batch-group-v3:${charKey}:${assignment.character}:${positionName}:${automation.batchMaleAnatomy}`.toLowerCase();
        const ready = automation.library.filter(item =>
            item.batchGroupKey === groupKey ||
            (!item.batchGroupKey && getBatchLibraryPrimaryCharacter(item).toLowerCase() === String(assignment.character).toLowerCase() && String(item.position || "").toLowerCase() === String(positionName).toLowerCase())
        );
        const pending = backgroundImageQueue.filter(job => job.metadata?.batchGroupKey === groupKey);
        if (backgroundActiveJob?.metadata?.batchGroupKey === groupKey) pending.push(backgroundActiveJob);
        const wanted = Math.max(1, parseInt(requestedCount, 10) || 1);
        const jobsToAdd = addMore ? wanted : Math.max(0, wanted - ready.length - pending.length);
        let nextVariant = Math.max(
            0,
            ...ready.map(item => parseInt(item.batchVariant, 10) || 0),
            ...pending.map(job => parseInt(job.metadata?.batchVariant, 10) || 0)
        ) + 1;
        let count = 0;
        for (let i = 0; i < jobsToAdd; i++, nextVariant++) {
            const scenePlan = buildBatchScenePlan(assignment, assignments, positionName, positionPrompt, s, automation);
            const batchKey = `${groupKey}:variant:${nextVariant}`;
            enqueueBackgroundImageJob({
                priority: "batch",
                libraryOnly: true,
                sceneText: scenePlan.sceneText,
                extraInstruction: scenePlan.extraInstruction,
                directPrompt: scenePlan.directPrompt,
                manualScene: scenePlan.manualScene,
                metadata: {
                    batchKey,
                    batchGroupKey: groupKey,
                    batchVariant: nextVariant,
                    primaryCharacter: assignment.character,
                    characters: scenePlan.characters,
                    position: positionName,
                    sceneType: "explicit",
                    source: "batch"
                }
            });
            count++;
        }
        return count;
    }

    function queueCharacterBatchJobs() {
        const s = getLocalProfile()?.imageGen;
        const automation = ensureBackgroundAutomationSettings(s);
        if (!automation.batchEnabled) throw new Error("Enable Batch Library Generator first.");
        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        const assignments = getModeCharacterAssignments(li, charKey).map(ensureStructuredCharacterAssignment).filter(a => !a.neverInclude && !assignmentHasMinorWording(a));
        if (!assignments.length) throw new Error("Analyze characters before starting a batch.");
        const positionNames = automation.batchPositions.map(v => String(v).trim()).filter(Boolean);
        if (!positionNames.length) throw new Error("Add at least one batch position.");
        let count = 0;
        for (const assignment of assignments) {
            for (const positionName of positionNames) {
                count += queueBatchCategoryJobs(assignment.character, positionName, automation.batchImagesPerGroup, false);
            }
        }
        return count;
    }

    async function handleBackgroundAutomation(triggerReason = "message-received") {
        const s = getLocalProfile()?.imageGen;
        if (!s?.enabled) return;
        const automation = ensureBackgroundAutomationSettings(s);
        if (!automation.autoEnabled && !automation.smartEnabled) return;
        const chat = getContext().chat || [];
        const message = chat[chat.length - 1];
        if (!message || message.is_user || message.is_system) return;
        const origin = getBackgroundOrigin(message);
        if (automation.lastProcessedRevisionKey === origin.revisionKey) return;
        if (backgroundOriginKeys.has(origin.originKey)) return;
        const aiCount = chat.filter(m => !m.is_user && !m.is_system).length;
        const cooldown = Math.max(0, parseInt(automation.cooldownReplies, 10) || 0);
        const lastAutoAiCount = parseInt(automation.lastAutoAiCount, 10) || 0;
        const isMessageRevision = automation.lastProcessedMessageIndex === origin.index && automation.lastProcessedRevisionKey !== origin.revisionKey;
        if (!isMessageRevision && lastAutoAiCount > 0 && aiCount - lastAutoAiCount <= cooldown) {
            if (automation.smartEnabled) setQwenStatus(`Skipped · cooldown (${triggerReason})`);
            return;
        }
        const sceneText = getSceneSnapshotForMessage(message);
        const latestSceneText = getLatestVisualSceneText(message);
        if (!sceneText || findZImageForbiddenMinorTerm(sceneText)) {
            if (automation.smartEnabled) setQwenStatus("Skipped · empty or age-safety guard");
            return;
        }
        automation.lastProcessedRevisionKey = origin.revisionKey;
        automation.lastProcessedMessageIndex = origin.index;
        saveProfileToMemory();
        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        const assignments = getModeCharacterAssignments(li, charKey).map(ensureStructuredCharacterAssignment).filter(a => !a.neverInclude);
        const knownNames = assignments.map(a => a.character).filter(Boolean);

        if (automation.smartEnabled) {
            try {
                setQwenStatus(`Checking ${triggerReason.replace(/-/g, " ")}…`);
                let qwenAnalysis;
                try {
                    qwenAnalysis = await classifySceneWithLocalQwen(sceneText, knownNames, automation);
                } catch (qwenError) {
                    if (!detectPositionPresetFromScene(latestSceneText) && !isExplicitSceneText(latestSceneText)) throw qwenError;
                    console.warn("[Megumin Suite] Qwen failed; using deterministic explicit-scene routing:", qwenError);
                    qwenAnalysis = {
                        trigger: false,
                        sceneType: "explicit",
                        characters: [],
                        position: "",
                        location: "",
                        clothing: "",
                        query: "",
                        confidence: 0
                    };
                    setQwenStatus("Qwen failed · deterministic explicit override");
                }
                const analysis = applyDeterministicSceneOverride(qwenAnalysis, latestSceneText, knownNames);
                if (analysis.trigger && analysis.confidence >= Number(automation.qwenMinConfidence || 0.7)) {
                    if (automation.smartSearchLibrary) {
                        const ready = findBestLibraryImage(analysis, automation);
                        if (ready && await attachLibraryImageToOrigin(ready, origin)) {
                            setQwenStatus(`Library hit · ${analysis.position || analysis.sceneType} · attached to message ${origin.index + 1}`);
                            automation.lastAutoAiCount = aiCount;
                            saveProfileToMemory();
                            return;
                        }
                    }
                    if (automation.smartGenerateFallback) {
                        // Qwen is only a trigger/library router. A fresh render lets
                        // NanoGPT infer the scene from RP text plus configured identity tags;
                        // neither Qwen JSON nor deterministic action presets constrain it.
                        const selected = getDeterministicSceneAssignments(s, latestSceneText);
                        const sceneType = isExplicitSceneText(latestSceneText) ? "explicit" : "normal";
                        const nanoContext = buildComfyNanoPromptContext(s, sceneText, {
                            assignments: selected,
                            positions: []
                        });
                        enqueueBackgroundImageJob({
                            priority: "smart",
                            origin,
                            originKey: origin.originKey,
                            sceneText,
                            directPrompt: nanoContext.fallbackPrompt,
                            aiText: nanoContext.aiText,
                            manualScene: selected.length ? { assignments: selected, positions: [] } : null,
                            metadata: {
                                source: "smart-fresh-render",
                                sceneType
                            }
                        });
                        setQwenStatus(`No library match · independent NanoGPT render queued for message ${origin.index + 1}`);
                        automation.lastAutoAiCount = aiCount;
                        saveProfileToMemory();
                        return;
                    }
                    setQwenStatus("Matched scene · no fallback action enabled");
                } else {
                    setQwenStatus(`No fetch · ${Math.round(analysis.confidence * 100)}% confidence${analysis.trigger ? " below threshold" : ""}`);
                }
            } catch (e) {
                console.warn("[Megumin Suite] Smart Qwen mode skipped this message:", e);
                setQwenStatus(`Error · ${e.message}`);
            }
        }

        if (automation.autoEnabled && shouldAutoGenerateScene(latestSceneText, automation)) {
            const position = detectPositionPresetFromScene(latestSceneText);
            const directPrompt = buildDeterministicBackgroundPrompt(s, latestSceneText, {
                position,
                sceneType: isExplicitSceneText(latestSceneText) ? "explicit" : "normal"
            });
            enqueueBackgroundImageJob({
                priority: "auto",
                origin,
                originKey: origin.originKey,
                sceneText,
                directPrompt,
                manualScene: position ? { assignments: getDeterministicSceneAssignments(s, latestSceneText), positions: [position] } : null,
                metadata: { source: "auto", sceneType: isExplicitSceneText(latestSceneText) ? "explicit" : "normal" }
            });
            if (automation.smartEnabled) {
                setQwenStatus(`Qwen skipped · Auto render queued for message ${origin.index + 1}`);
            }
            automation.lastAutoAiCount = aiCount;
            saveProfileToMemory();
        }
    }

    function registerImageSwipeHandler() {
        const meguminSwipeHandler = async (data) => {
            const s = getLocalProfile()?.imageGen;
            if (!s || !s.enabled) return;

            const { message, direction, element } = data;
            if (direction !== "right") return;

            const media = message.extra?.media || [];
            const idx = message.extra?.media_index || 0;
            if (idx < media.length - 1) return;

            const mediaObj = media[idx];
            const storedPrompt = String(mediaObj?.prompt || mediaObj?.title || "").trim();
            if (!storedPrompt) return;

            let ogPower = null;
            if (window.power_user && window.power_user.image_overswipe) {
                ogPower = window.power_user.image_overswipe;
                window.power_user.image_overswipe = "off";
            }

            let ogExt = null;
            if (extension_settings.image_generation && extension_settings.image_generation.overswipe) {
                ogExt = extension_settings.image_generation.overswipe;
                extension_settings.image_generation.overswipe = false;
            }

            setTimeout(() => {
                if (ogPower && window.power_user) window.power_user.image_overswipe = ogPower;
                if (ogExt && extension_settings.image_generation) extension_settings.image_generation.overswipe = ogExt;
            }, 200);

            toastr.info("Regenerating Image...", "Megumin Suite");
            await igGenerateWithComfy(storedPrompt, { message: message, element: $(element) }, { preserveStoredPrompt: true });
        };

        eventSource.on(event_types.IMAGE_SWIPED, meguminSwipeHandler);

        if (eventSource._events && Array.isArray(eventSource._events[event_types.IMAGE_SWIPED])) {
            const arr = eventSource._events[event_types.IMAGE_SWIPED];
            if (arr.length > 1 && arr[arr.length - 1] === meguminSwipeHandler) {
                arr.unshift(arr.pop());
            }
        }
    }

    return {
        renderImageGen,
        renderVideoGen,
        toggleQuickGenButton,
        loadDanbooruTags,
        igGenerateWithComfy,
        igManualGenerate,
        getCleanedChatHistory,
        cleanMessageTextForKeywords,
        stripUtilityThinkingWrapper,
        extendBaseDict,
        handlePromptInjection,
        handleMessageReceived,
        handleBackgroundAutomation,
        registerImageSwipeHandler,
    };
}
