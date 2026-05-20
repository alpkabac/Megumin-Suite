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
    let activeLoraStateUpdateRequest = null;
    let activeVideoGenJob = false;
    const completedVideoPromptIds = new Set();
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

    const VLM_CHARACTER_MODELS = [
        "qwen/qwen3.6-27b",
        "qwen/qwen3-vl-32b-instruct",
        "google/gemma-4-31b-it"
    ];

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
        if (a.action_tags === undefined) a.action_tags = "";
        if (a.pose_expression_tags === undefined) a.pose_expression_tags = "";
        if (a.current_state_tags === undefined) a.current_state_tags = "";
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
            { key: "clothingTags", label: "Clothes" },
            { key: "actionTags", label: "Action" },
            { key: "poseExpressionTags", label: "Pose" },
            { key: "currentStateTags", label: "State" },
            { key: "sceneAction", label: "Scene" }
        ];
    }

    function ensureLoraIntelDefaults(li) {
        if (!li) return;
        if (li.ensureCharacterTag === undefined) li.ensureCharacterTag = false;
        if (li.descriptionStyle === undefined) li.descriptionStyle = 'booru';
        if (li.promptAssemblyMode === undefined) li.promptAssemblyMode = 'structured';
        if (li.assignmentViewMode === undefined) li.assignmentViewMode = 'structured';
        if (li.vlmModel === undefined) li.vlmModel = 'qwen/qwen3-vl-32b-instruct';
        if (li.lastCharacterAnalysisResponse === undefined) li.lastCharacterAnalysisResponse = "";
        if (li.compiledPromptOverride === undefined) li.compiledPromptOverride = "";
        if (!li.tagFieldToggles) li.tagFieldToggles = {};
        const defaults = {
            background: true,
            composition: true
        };
        getTagFieldToggleDefaults().forEach(({ key }) => { defaults[key] = true; });
        Object.keys(defaults).forEach(key => {
            if (li.tagFieldToggles[key] === undefined) li.tagFieldToggles[key] = defaults[key];
        });
    }

    function normalizeStructuredCharacterAssignment(a) {
        ensureStructuredCharacterAssignment(a);
        if (!a || typeof a !== 'object') return a;

        ['booru_tags', 'character_tag', 'series_tag', 'physical_tags', 'clothing_tags', 'action_tags', 'pose_expression_tags', 'current_state_tags'].forEach(key => {
            if (a[key]) a[key] = normalizeGeneratedTagField(a[key]);
        });

        const mergedTags = [
            a.character_tag,
            a.series_tag,
            a.physical_tags,
            a.clothing_tags,
            a.action_tags,
            a.pose_expression_tags,
            a.current_state_tags
        ].filter(Boolean).join(', ');

        a.booru_tags = mergedTags || normalizeGeneratedTagField(a.booru_tags || "");
        if (!a.plain_description) {
            a.plain_description = mergedTags || a.description || "";
        }
        return a;
    }

    function ensureStructuredCharacterAssignments(li, charKey = null) {
        if (!li || !li.characterAssignments) return;
        const keys = charKey ? [charKey] : Object.keys(li.characterAssignments);
        keys.forEach(key => {
            if (!Array.isArray(li.characterAssignments[key])) return;
            li.characterAssignments[key].forEach(ensureStructuredCharacterAssignment);
        });
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
    async function fetchCivitaiKeywords(loraFilename) {
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

    function renderImageGen(c) {
        c.empty();
        const s = getLocalProfile().imageGen;
        ensureImageGenLoraArrays(s);
        if (s.standardBooruLeadTags === undefined) s.standardBooruLeadTags = "";

        // LoRA Intelligence state
        if (!s.loraIntel) s.loraIntel = { enabled: false, ensureLoras: false, useDanbooruTags: true, ensureCharacterTag: false, useCharDescriptions: false, descriptionStyle: 'booru', promptAssemblyMode: 'structured', globalActiveLoras: [], characterActiveLoras: {}, characterAssignments: {}, lastCharacterAnalysisResponse: "", compiledPromptOverride: "" };
        if (s.manualPrompt === undefined) s.manualPrompt = "";
        ensureLoraIntelDefaults(s.loraIntel);
        const li = s.loraIntel;
        const charKey = getCharacterKey() || "default";
        ensureStructuredCharacterAssignments(li, charKey);
        const liScope = li.characterActiveLoras[charKey] ? 'character' : 'global';
        const liAssignments = (li.characterAssignments[charKey] || []);

        c.append(`
            <!-- MASTER TOGGLE -->
            <div class="ps-toggle-card ${s.enabled ? 'active' : ''}" id="ig_enable_card" style="border-color: ${s.enabled ? 'var(--gold)' : 'var(--border-color)'};">
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:700; font-size: 1.1rem; color: ${s.enabled ? 'var(--gold)' : 'var(--text-main)'};"><i class="fa-solid fa-image"></i> Enable Image Generation</span>
                    <div style="margin-top:4px; font-size: 0.8rem; color: var(--text-muted);">Activate ComfyUI integration for this specific character/group.</div>
                </div>
                <div class="ps-switch"></div>
            </div>
            <!-- Generator Backend -->
                <div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-gears"></i> Prompt Generator Backend</div>
                    <div style="display: flex; align-items: center; gap: 15px;">
                        <div style="flex: 1;">
                            <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-main);">Generation Method</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted);">"Direct" is faster. "Megumin Image" is more creative and follows your preset instructions.</div>
                        </div>
                        <select id="img_gen_backend" class="ps-modern-input" style="width: 220px; cursor: pointer;">
                            <option value="direct" ${s.generatorBackend === 'direct' ? 'selected' : ''}>Direct API Call (Fast)</option>
                            <option value="preset" ${s.generatorBackend === 'preset' ? 'selected' : ''}>Megumin Image Preset</option>
                        </select>
                    </div>
                </div>

            <div id="ig_main_content" style="display: ${s.enabled ? 'block' : 'none'};">

                <!-- Connection & Workflow -->
                <div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
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

                <div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
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

                    <div id="ig_prompt_builder" style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px; border-left: 3px solid var(--gold);">
                        <div style="display: flex; gap: 15px; margin-bottom: 10px;">
                            <div style="flex: 1;">
                                <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Model Style Format</div>
                                <select id="ig_style" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;">
                                    <option value="standard" ${s.promptStyle === 'standard' ? 'selected' : ''}>Standard (Descriptive)</option>
                                    <option value="illustrious" ${s.promptStyle === 'illustrious' ? 'selected' : ''}>Illustrious/Pony (Tags)</option>
                                    <option value="sdxl" ${s.promptStyle === 'sdxl' ? 'selected' : ''}>SDXL (Natural Prose)</option>
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

                <!-- Parameters Grid -->
                <div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div class="ps-rule-title" style="margin-bottom: 12px;"><i class="fa-solid fa-sliders"></i> Image Parameters</div>

                    <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                        <select id="ig_model" class="ps-modern-input" style="flex: 2;"><option value="">Loading Models...</option></select>
                        <select id="ig_sampler" class="ps-modern-input" style="flex: 1;"><option value="">Loading Samplers...</option></select>
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
                <div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
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
                <div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
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
                        <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                            <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                                <div style="flex: 1; min-width: 220px;">
                                    <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-main);">Prompt Assembly</div>
                                    <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 2px;">Structured keeps exact Anima character tags in code; LLM Full lets the model write the whole prompt.</div>
                                </div>
                                <select id="li_prompt_assembly_mode" class="ps-modern-input" style="width: 240px; padding: 8px; font-size: 0.75rem;">
                                    <option value="structured" ${li.promptAssemblyMode === 'structured' ? 'selected' : ''}>Structured Character Blocks</option>
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
                                ${liTagFieldToggle("li_field_action_tags", "Action Field", li.tagFieldToggles.actionTags)}
                                ${liTagFieldToggle("li_field_pose", "Pose / Expression", li.tagFieldToggles.poseExpressionTags)}
                                ${liTagFieldToggle("li_field_state", "Current State", li.tagFieldToggles.currentStateTags)}
                                ${liTagFieldToggle("li_field_action", "AI Scene Action", li.tagFieldToggles.sceneAction)}
                                ${liTagFieldToggle("li_field_background", "Background", li.tagFieldToggles.background)}
                                ${liTagFieldToggle("li_field_composition", "Composition", li.tagFieldToggles.composition)}
                            </div>
                        </div>

                        <!-- LoRA Browser -->
                        <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
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
                        <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <span style="font-weight: 700; font-size: 0.85rem; color: var(--text-main);"><i class="fa-solid fa-users-gear" style="color: var(--gold); margin-right: 6px;"></i>AI Character → LoRA Assignment</span>
                                <button id="li_analyze_btn" class="ps-modern-btn primary" style="background: var(--gold); color: #000; padding: 6px 14px; font-size: 0.75rem; font-weight: 800;">
                                    <i class="fa-solid fa-bolt"></i> Analyze Characters
                                </button>
                            </div>
                            <div style="display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 12px;">
                                <div style="flex: 1; min-width: 220px;">
                                    <div style="font-size: 0.65rem; font-weight: 800; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Card Image VLM Model</div>
                                    <select id="li_vlm_model" class="ps-modern-input" style="padding: 7px; font-size: 0.75rem;">
                                        ${VLM_CHARACTER_MODELS.map(m => `<option value="${psEscapeAttr(m)}" ${li.vlmModel === m ? 'selected' : ''}>${psEscapeText(m)}</option>`).join("")}
                                    </select>
                                </div>
                                <div style="width: 180px;">
                                    <div style="font-size: 0.65rem; font-weight: 800; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Description Style</div>
                                    <select id="li_vlm_style" class="ps-modern-input" style="padding: 7px; font-size: 0.75rem;">
                                        <option value="booru" ${li.descriptionStyle === 'booru' ? 'selected' : ''}>Booru Tags</option>
                                        <option value="natural" ${li.descriptionStyle === 'natural' ? 'selected' : ''}>Natural Language</option>
                                    </select>
                                </div>
                                <button id="li_analyze_card_image_btn" class="ps-modern-btn secondary" style="padding: 7px 12px; font-size: 0.75rem;">
                                    <i class="fa-solid fa-id-card"></i> Analyze Card Image
                                </button>
                                <button id="li_refresh_active_states_btn" class="ps-modern-btn secondary" style="padding: 7px 12px; font-size: 0.75rem;">
                                    <i class="fa-solid fa-rotate"></i> Refresh Active States
                                </button>
                            </div>
                            <div id="li_assignment_table" style="min-height: 40px;">
                                ${liAssignments.length > 0 ? '' : '<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 15px; border: 1px dashed var(--border-color); border-radius: 8px;">No assignments yet. Click "Analyze Characters" to let AI map characters to LoRAs.</div>'}
                            </div>
                        </div>

                        <!-- Manual Render -->
                        <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 15px; margin-bottom: 20px;">
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
                                <i id="li_prompt_chevron" class="fa-solid fa-chevron-down" style="color: var(--text-muted); transition: transform 0.2s;"></i>
                            </div>
                            <div id="li_prompt_preview_body" style="display: none; padding: 0 15px 15px 15px;">
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

        // Inputs
        $("#ig_url").on("input", (e) => {
            meguminComfyLoraCache = null;
            meguminComfyLoraCacheUrl = "";
            s.comfyUrl = $(e.target).val();
            saveProfileToMemory();
        });
        $("#ig_style").on("change", (e) => { s.promptStyle = $(e.target).val(); saveProfileToMemory(); });
        $("#ig_persp").on("change", (e) => { s.promptPerspective = $(e.target).val(); saveProfileToMemory(); });
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
                    selectedModel: s.selectedModel, selectedSampler: s.selectedSampler, steps: s.steps, cfg: s.cfg, denoise: s.denoise, clipSkip: s.clipSkip,
                    imgWidth: s.imgWidth, imgHeight: s.imgHeight, customSeed: s.customSeed, customNegative: s.customNegative,
                    promptStyle: s.promptStyle, promptPerspective: s.promptPerspective, promptExtra: s.promptExtra, standardBooruLeadTags: s.standardBooruLeadTags, previewPrompt: s.previewPrompt,
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
        bindLiTagToggle("li_field_action_tags", "actionTags");
        bindLiTagToggle("li_field_pose", "poseExpressionTags");
        bindLiTagToggle("li_field_state", "currentStateTags");
        bindLiTagToggle("li_field_action", "sceneAction");
        bindLiTagToggle("li_field_background", "background");
        bindLiTagToggle("li_field_composition", "composition");
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
        $("#li_vlm_model").on("change", function() {
            li.vlmModel = $(this).val();
            saveProfileToMemory();
        });
        $("#li_vlm_style").on("change", function() {
            li.descriptionStyle = $(this).val();
            saveProfileToMemory();
            $("#li_desc_style").val(li.descriptionStyle);
        });
        $("#li_analyze_card_image_btn").on("click", function() {
            liAnalyzeCardImage(li, charKey, s, $(this));
        });
        $("#li_refresh_active_states_btn").on("click", function() {
            liRefreshActiveCharacterStates(li, charKey, s, $(this));
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
            if (body.is(":visible")) { body.slideUp(200); chevron.css("transform", "rotate(0deg)"); }
            else { body.slideDown(200); chevron.css("transform", "rotate(180deg)"); }
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
        igRefreshLastComfyApiPanel();

        // Refresh LoRA list
        $("#li_refresh_btn").on("click", async function() {
            $(this).prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i>');
            await liPopulateLoraList(s, li, charKey);
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

            const scope = $("#li_scope_select").val();
            const activeList = scope === "character" && li.characterActiveLoras[charKey] ? li.characterActiveLoras[charKey] : li.globalActiveLoras;
            const enabledLoras = activeList.filter(l => l.enabled);

            btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...');

            try {
                if (li.useDanbooruTags) await loadDanbooruTags();

                const loraListStr = enabledLoras.map(l => {
                    const kw = l.keywords && l.keywords.length > 0 ? ` (keywords: ${l.keywords.join(', ')})` : '';
                    return `- ${l.name}${kw}`;
                }).join('\n');

                activeLoraAssignRequest = {
                    chatText: chatText,
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
                                ['booru_tags', 'character_tag', 'series_tag', 'physical_tags', 'clothing_tags', 'action_tags', 'pose_expression_tags', 'current_state_tags'].forEach(key => {
                                    if (!a[key]) return;
                                    const repairedTags = danbooruTagsMap && danbooruTagsMap.size > 0 ? repairBooruTags(a[key]) : a[key];
                                    a[key] = normalizeGeneratedTagField(repairedTags);
                                });
                                normalizeStructuredCharacterAssignment(a);
                            }
                        }

                        li.characterAssignments[charKey] = assignments;
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

    function igBuildLastComfyApiSnapshot(s, workflow, finalPrompt, finalSeed, l1, l2, l3, l4, w1, w2, w3, w4) {
        const fullPayload = { prompt: JSON.parse(JSON.stringify(workflow)) };
        const cs = parseInt(s.clipSkip, 10);
        return {
            at: new Date().toISOString(),
            comfy_url: s.comfyUrl,
            workflow_file: s.currentWorkflowName,
            positive_prompt: finalPrompt,
            negative_prompt: s.customNegative || "",
            final_seed: finalSeed,
            megumin: {
                model: s.selectedModel || "",
                sampler: s.selectedSampler || "",
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
                }
            } catch (e) {
                container.html('<div style="text-align: center; color: #ef4444; font-size: 0.8rem; padding: 15px;">Failed to fetch LoRAs from ComfyUI.</div>');
                return;
            }
        }

        container.empty();
        let loraFiles = cachedLoraFiles || [];

        if (loraFiles.length === 0) {
            container.html('<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 15px;">No LoRAs found in ComfyUI.</div>');
            return;
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
            const keywordsStr = existing && existing.keywords && existing.keywords.length ? existing.keywords.join(', ') : '';
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
                } else {
                    let defaultKws = civitaiKeywordCache[loraName.replace(/\.(safetensors|ckpt|pt|bin)$/i, '').replace(/\\|\/|\s/g, ' ').trim()];
                    if (!defaultKws || defaultKws.length === 0) defaultKws = ["a woman"];
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
                        existingEntry.keywords = $(this).val().split(',').map(s => s.trim()).filter(s => s);
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
    }

    function liRenderAssignmentTable(li, charKey, s) {
        const table = $("#li_assignment_table");
        table.empty();

        if (!li.ensureLoras && !li.useCharDescriptions && !li.useDanbooruTags) {
            table.hide();
            return;
        } else {
            table.show();
        }

        if (!li.characterAssignments[charKey]) li.characterAssignments[charKey] = [];
        const assignments = li.characterAssignments[charKey];

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
                <button id="li_add_custom_assign" class="ps-modern-btn primary" style="padding: 2px 8px; font-size: 0.65rem; margin-left: 10px; background: var(--gold); color: #000;"><i class="fa-solid fa-plus"></i> Add</button>
            </div>
        `);

        header.find("#li_add_custom_assign").on("click", function() {
            assignments.push(ensureStructuredCharacterAssignment({ character: "", match_keywords: "", lora: "", description: "", plain_description: "", booru_tags: "", character_tag: "", series_tag: "", physical_tags: "", clothing_tags: "", action_tags: "", pose_expression_tags: "", current_state_tags: "", alwaysInclude: false, neverInclude: false }));
            li.characterAssignments[charKey] = assignments;
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
                        li.characterAssignments[charKey] = assignments;
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
                            <button type="button" class="ps-modern-btn secondary li-update-state" title="Update clothing, pose, and current state from the latest chat messages" style="padding: 5px 8px; font-size: 0.65rem; color: #3b82f6; border-color: rgba(59,130,246,0.3);"><i class="fa-solid fa-rotate"></i> State</button>
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
                            ${tagField('action_tags', 'Action', 'holding sword, dancing')}
                            ${tagField('pose_expression_tags', 'Pose / Expression', 'arms crossed, frown')}
                            ${tagField('current_state_tags', 'Current State', 'wet hair, bruised cheek')}
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
                        a.clothing_tags,
                        a.action_tags,
                        a.pose_expression_tags,
                        a.current_state_tags
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
                row.find(".li-update-state").on("click", function() {
                    liUpdateCharacterStateTags(li, charKey, s, a, $(this));
                });
                row.find(".li-remove-assign").on("click", function() {
                    assignments.splice(idx, 1);
                    li.characterAssignments[charKey] = assignments;
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
                        <button type="button" class="ps-modern-btn secondary li-always-include ${a.alwaysInclude ? 'active' : ''}" title="Always include this character even when match keywords are absent from recent chat" style="padding: 2px 6px; font-size: 0.6rem; color: ${a.alwaysInclude ? '#10b981' : 'var(--text-muted)'}; border-color: ${a.alwaysInclude ? 'rgba(16,185,129,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-thumbtack"></i></button>
                        <button type="button" class="ps-modern-btn secondary li-never-include ${a.neverInclude ? 'active' : ''}" title="Never include this character in prompts, LoRAs, or manual tag insertion" style="padding: 2px 6px; font-size: 0.6rem; color: ${a.neverInclude ? '#ef4444' : 'var(--text-muted)'}; border-color: ${a.neverInclude ? 'rgba(239,68,68,0.45)' : 'var(--border-color)'};"><i class="fa-solid fa-ban"></i></button>
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
                li.characterAssignments[charKey] = assignments;
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

    async function igManualGenerate() {
        const s = getLocalProfile()?.imageGen;
        if (!s || !s.enabled) return;

        showKazumaProgress("Analyzing Scene...");

        try {
            let gen;
            if (s.generatorBackend === "direct") {
                gen = await generateImagePromptText();
            } else {
                gen = null;
                await useMeguminEngine(async () => {
                    gen = await generateImagePromptText();
                }, "Megumin Image");
            }

            let promptText = gen ? gen.prompt : "";
            const skipLeadPrefix = !!(gen && gen.skipLeadPrefix);

            const imgRegex = /<img\s+prompt=["'](.*?)["']\s*\/?>/i;
            const match = promptText.match(imgRegex);
            if (match) promptText = match[1];

            toastr.info("Sending to ComfyUI...", "Megumin Suite");
            igGenerateWithComfy(promptText, null, { skipLeadPrefix });

        } catch(e) {
            console.error(e);
            $("#kazuma_progress_overlay").hide();
            toastr.error("Manual generation failed.");
        } finally {
            activeImageGenRequest = null;
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
        if (!li || !li.characterAssignments || !li.characterAssignments[charKey] || li.characterAssignments[charKey].length === 0) {
            toastr.warning("No character assignments available. Analyze characters first.");
            return;
        }
        let assignments = getMatchedCharacterAssignments(li, charKey);
        if (assignments.length === 0) assignments = li.characterAssignments[charKey].map(ensureStructuredCharacterAssignment).filter(a => !a.neverInclude);

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
    function getMatchedBooruTags(li, charKey) {
        if (!li || !li.enabled || !li.useDanbooruTags) return [];
        const matched = [];

        for (const a of getActiveCharacterAssignments(li, charKey)) {
            ensureStructuredCharacterAssignment(a);
            const tagBlock = getAssignmentTagBlock(a, li) || a.booru_tags;
            if (!tagBlock) continue;
            matched.push({ character: a.character, tags: tagBlock });
        }
        return matched;
    }

    function getMatchedCharacterAssignments(li, charKey) {
        if (!li || !li.enabled) return [];
        return getActiveCharacterAssignments(li, charKey);
    }

    function getActiveCharacterAssignments(li, charKey) {
        if (!li || !li.characterAssignments) return [];
        const assignments = li.characterAssignments[charKey] || [];
        if (assignments.length === 0) return [];

        const recentChat = getRecentChatForLoraKeywords();
        const allowEmptyMatch = assignments.length <= 1;
        return assignments
            .map(ensureStructuredCharacterAssignment)
            .filter(a => assignmentMatchesRecentChat(a, recentChat, allowEmptyMatch));
    }

    function getRecentVisualContext(messageCount = 2) {
        const chat = getContext().chat || [];
        return chat
            .filter(m => !m.is_system)
            .slice(-messageCount)
            .map(m => {
                const text = cleanMessageTextForKeywords(m.mes);
                return `${m.name}: ${text.trim()}`;
            })
            .join("\n\n");
    }

    function getCurrentCharacterCardImageUrl() {
        const context = getContext();
        if (context.characterId !== undefined && context.characterId !== null && context.characters?.[context.characterId]?.avatar) {
            return `/characters/${context.characters[context.characterId].avatar}`;
        }
        if (context.groupId !== undefined && context.groupId !== null && Array.isArray(context.groups)) {
            const group = context.groups.find(g => String(g.id) === String(context.groupId));
            const avatar = group?.avatar_url || group?.avatar;
            if (avatar) return String(avatar).startsWith("/") ? avatar : `/characters/${avatar}`;
        }
        return "";
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    async function getCurrentCharacterCardDataUrl() {
        const imageUrl = getCurrentCharacterCardImageUrl();
        if (!imageUrl) throw new Error("No character card image is available for this chat.");
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`Could not load card image (${res.status}).`);
        return await blobToDataUrl(await res.blob());
    }

    function extractAssistantTextFromResponse(data) {
        if (!data) return "";
        if (typeof data === "string") return data;
        return data?.choices?.[0]?.message?.content
            || data?.choices?.[0]?.text
            || data?.content
            || data?.text
            || data?.response
            || data?.result
            || "";
    }

    function extractJsonArrayFromText(rawText) {
        const cleaned = stripUtilityThinkingWrapper(String(rawText || "")).replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
        const match = cleaned.match(/\[[\s\S]*\]/);
        if (!match) throw new Error("VLM did not return a JSON array.");
        return JSON.parse(match[0]);
    }

    async function requestCardImageVlmDescription({ imageDataUrl, model, style }) {
        const styleRule = style === "natural"
            ? "Use concise natural language in plain_description, but still fill the structured tag fields with short visual phrases."
            : "Use concise Danbooru-style comma-separated tags in the structured fields and plain_description.";
        const prompt = `Analyze the attached character card image. The image may contain one visible character or multiple visible characters in the same card art.\n\nReturn ONLY a JSON array. Use generic labels only: "character 1", "character 2", "character 3", etc. Do not invent story names.\n\nEach object must use this exact shape:\n{\n  "character": "character 1",\n  "match_keywords": "",\n  "character_tag": "",\n  "series_tag": "",\n  "physical_tags": "detailed face, hair, eyes, skin, body shape, chest, height/build tags",\n  "clothing_tags": "visible outfit/accessories only",\n  "action_tags": "visible activity or held objects only",\n  "pose_expression_tags": "pose, gaze, emotion, facial expression",\n  "current_state_tags": "temporary visible state such as wet hair, dirt, injuries, tears, empty if none",\n  "plain_description": "detailed facial and body description",\n  "alwaysInclude": true\n}\n\nRules:\n- Describe only visible adult-presenting characters.\n- If multiple people are visible, create one object per person from left to right.\n- Focus on facial features, hair, eyes, body proportions, outfit, pose, expression, and distinguishing marks.\n- ${styleRule}`;

        const messages = [{
            role: "user",
            content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: imageDataUrl } }
            ]
        }];
        const headers = { ...getRequestHeaders(), "Content-Type": "application/json" };
        const body = JSON.stringify({ messages, model, temperature: 0.2, max_tokens: 1600, stream: false });
        const endpoints = [
            "/api/backends/chat-completions/generate",
            "/api/openai/generate"
        ];
        let lastError = null;
        for (const endpoint of endpoints) {
            try {
                const res = await fetch(endpoint, { method: "POST", headers, body });
                const raw = await res.text();
                let data = raw;
                try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
                if (!res.ok) {
                    lastError = new Error(data?.error?.message || data?.error || `${endpoint} returned ${res.status}`);
                    continue;
                }
                const text = extractAssistantTextFromResponse(data);
                if (text) return text;
                lastError = new Error(`${endpoint} returned no text.`);
            } catch (e) {
                lastError = e;
            }
        }
        throw lastError || new Error("VLM request failed.");
    }

    async function liAnalyzeCardImage(li, charKey, s, btn) {
        ensureLoraIntelDefaults(li);
        if (!charKey) return toastr.warning("Open a character or group chat first.");
        btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...');
        try {
            if (li.useDanbooruTags) await loadDanbooruTags();
            const imageDataUrl = await getCurrentCharacterCardDataUrl();
            const model = li.vlmModel || "qwen/qwen3-vl-32b-instruct";
            let rawOutput = "";
            if (s.generatorBackend === "direct") {
                rawOutput = await requestCardImageVlmDescription({ imageDataUrl, model, style: li.descriptionStyle });
            } else {
                await useMeguminEngine(async () => {
                    rawOutput = await requestCardImageVlmDescription({ imageDataUrl, model, style: li.descriptionStyle });
                });
            }
            const parsed = extractJsonArrayFromText(rawOutput);
            const previous = Array.isArray(li.characterAssignments?.[charKey]) ? li.characterAssignments[charKey] : [];
            const assignments = parsed.map((item, idx) => {
                const a = ensureStructuredCharacterAssignment(item && typeof item === "object" ? item : {});
                a.character = `character ${idx + 1}`;
                a.match_keywords = "";
                a.alwaysInclude = true;
                if (previous[idx]?.neverInclude) {
                    a.neverInclude = true;
                    a.alwaysInclude = false;
                }
                if (!a.lora && previous[idx]?.lora) a.lora = previous[idx].lora;
                if (li.useDanbooruTags) {
                    ['booru_tags', 'character_tag', 'series_tag', 'physical_tags', 'clothing_tags', 'action_tags', 'pose_expression_tags', 'current_state_tags'].forEach(key => {
                        if (!a[key]) return;
                        const repairedTags = danbooruTagsMap && danbooruTagsMap.size > 0 ? repairBooruTags(a[key]) : a[key];
                        a[key] = normalizeGeneratedTagField(repairedTags);
                    });
                }
                return normalizeStructuredCharacterAssignment(a);
            }).filter(a => getAssignmentTagBlock(a, li) || a.plain_description || a.description);

            if (assignments.length === 0) throw new Error("VLM returned no usable character descriptions.");
            li.characterAssignments[charKey] = assignments;
            li.lastCharacterAnalysisResponse = rawOutput;
            saveProfileToMemory();
            liRenderAssignmentTable(li, charKey, s);
            $("#li_last_analysis_body").val(rawOutput);
            toastr.success(`Card image mapped ${assignments.length} character${assignments.length === 1 ? "" : "s"}.`);
        } catch (e) {
            toastr.error("Card image analysis failed: " + e.message);
            console.error("[Megumin Suite] Card image VLM analysis failed:", e);
        } finally {
            btn.prop("disabled", false).html('<i class="fa-solid fa-id-card"></i> Analyze Card Image');
        }
    }

    function getCharacterSlotLabel(index, total) {
        if (total <= 1) return "main character";
        const labels = ["first character", "second character", "third character", "fourth character", "fifth character", "sixth character"];
        return labels[index] || `character ${index + 1}`;
    }

    function getAssignmentTagBlock(a, li = null) {
        ensureStructuredCharacterAssignment(a);
        const parts = getAssignmentTagParts(a, li);
        return normalizeGeneratedTagField(parts.join(', '));
    }

    function getAssignmentTagParts(a, li) {
        ensureStructuredCharacterAssignment(a);
        if (li?.assignmentViewMode === 'plain') {
            return [a.plain_description || a.description || a.booru_tags || ""].filter(Boolean);
        }
        const globalToggles = li?.tagFieldToggles || {};
        const rowToggles = a?.tagFieldToggles || {};
        const enabled = (key) => globalToggles[key] !== false && rowToggles[key] !== false;
        return [
            enabled("characterTag") ? a.character_tag : "",
            enabled("seriesTag") ? a.series_tag : "",
            enabled("physicalTags") ? a.physical_tags : "",
            enabled("clothingTags") ? a.clothing_tags : "",
            enabled("actionTags") ? a.action_tags : "",
            enabled("poseExpressionTags") ? a.pose_expression_tags : "",
            enabled("currentStateTags") ? a.current_state_tags : ""
        ].filter(Boolean);
    }

    function buildStructuredCharacterActionReference(assignments) {
        if (!Array.isArray(assignments) || assignments.length === 0) return "";
        const total = assignments.length;
        return assignments.map((a, idx) => {
            const name = (a.character || `character ${idx + 1}`).trim();
            return `${getCharacterSlotLabel(idx, total)} = ${name}`;
        }).join(' | ');
    }

    function normalizeStructuredPromptValue(value) {
        return normalizeGeneratedTagField(String(value || "").replace(/\n+/g, ', '));
    }

    function parseStructuredSceneResponse(rawText, assignments) {
        const parsed = { background: "", composition: "", actions: {} };
        const fallback = [];
        const total = Array.isArray(assignments) ? assignments.length : 0;
        const slotLabels = (assignments || []).map((_, idx) => getCharacterSlotLabel(idx, total).toLowerCase());

        String(rawText || "").split(/\r?\n/).forEach(line => {
            const clean = line.trim().replace(/^[-*]\s*/, "");
            if (!clean) return;
            const match = clean.match(/^([^:]+):\s*(.+)$/);
            if (!match) {
                fallback.push(clean);
                return;
            }

            const key = match[1].trim().toLowerCase();
            const value = match[2].trim();
            if (!value) return;

            if (key === "background" || key === "scene" || key === "environment") {
                parsed.background = value;
                return;
            }
            if (key === "composition" || key === "camera" || key === "layout") {
                parsed.composition = value;
                return;
            }

            const slot = slotLabels.find(label => key.includes(label));
            if (slot && (key.includes("action") || key.includes("pose") || key.includes("expression") || key.includes("placement"))) {
                parsed.actions[slot] = value;
                return;
            }

            fallback.push(value);
        });

        if (!parsed.background && fallback.length > 0) parsed.background = fallback.join(', ');
        return parsed;
    }

    function buildStructuredKeyValuePrompt({ s, li, sceneText, assignments }) {
        const lead = normalizeStructuredPromptValue(buildBooruStandardTagLead(s, li));
        const extraTags = normalizeStructuredPromptValue(s?.promptExtra || "");
        const parsed = parseStructuredSceneResponse(sceneText, assignments);
        const total = Array.isArray(assignments) ? assignments.length : 0;
        const globalToggles = li?.tagFieldToggles || {};
        const enabled = (a, key) => globalToggles[key] !== false && (!a || a.tagFieldToggles?.[key] !== false);
        const globalEnabled = (key) => globalToggles[key] !== false;
        const lines = [];

        const tags = [lead, extraTags].filter(Boolean).join(', ');
        if (tags) lines.push(`tags: ${tags}`);
        lines.push("characters:");

        (assignments || []).forEach((a, idx) => {
            ensureStructuredCharacterAssignment(a);
            const label = getCharacterSlotLabel(idx, total);
            const slotKey = label.toLowerCase();
            const usePlain = li?.assignmentViewMode === 'plain';
            const identity = usePlain ? "" : normalizeStructuredPromptValue([
                enabled(a, "characterTag") ? a.character_tag : "",
                enabled(a, "seriesTag") ? a.series_tag : ""
            ].filter(Boolean).join(', '));
            const appearance = usePlain ? normalizeStructuredPromptValue(a.plain_description || a.description || a.booru_tags || "") : normalizeStructuredPromptValue([
                enabled(a, "physicalTags") ? a.physical_tags : "",
                enabled(a, "currentStateTags") ? a.current_state_tags : ""
            ].filter(Boolean).join(', '));
            const clothes = usePlain ? "" : normalizeStructuredPromptValue(enabled(a, "clothingTags") ? a.clothing_tags : "");
            const action = usePlain ? normalizeStructuredPromptValue(enabled(a, "sceneAction") ? parsed.actions[slotKey] : "") : normalizeStructuredPromptValue([
                enabled(a, "sceneAction") ? parsed.actions[slotKey] : "",
                enabled(a, "actionTags") ? a.action_tags : "",
                enabled(a, "poseExpressionTags") ? a.pose_expression_tags : ""
            ].filter(Boolean).join(', '));

            lines.push(`${label}:`);
            if (identity) lines.push(`identity: ${identity}`);
            if (appearance) lines.push(`appearance: ${appearance}`);
            if (clothes) lines.push(`clothes: ${clothes}`);
            if (action) lines.push(`action: ${action}`);
        });

        const background = normalizeStructuredPromptValue(parsed.background);
        const composition = normalizeStructuredPromptValue(parsed.composition);
        if (globalEnabled("background") && background) lines.push(`background: ${background}`);
        if (globalEnabled("composition") && composition) lines.push(`composition: ${composition}`);

        return lines.join('\n');
    }

    function isAssignmentFieldEnabled(li, assignment, key) {
        const globalToggles = li?.tagFieldToggles || {};
        const rowToggles = assignment?.tagFieldToggles || {};
        return globalToggles[key] !== false && rowToggles[key] !== false;
    }

    function getRefreshableStateFields(li, assignment) {
        const fields = [];
        if (isAssignmentFieldEnabled(li, assignment, "clothingTags")) fields.push({ key: "clothing_tags", label: "clothing_tags", hint: "current outfit/accessory tags only" });
        if (isAssignmentFieldEnabled(li, assignment, "poseExpressionTags")) fields.push({ key: "pose_expression_tags", label: "pose_expression_tags", hint: "current pose/expression/action tags only" });
        if (isAssignmentFieldEnabled(li, assignment, "currentStateTags")) fields.push({ key: "current_state_tags", label: "current_state_tags", hint: "temporary state tags only, such as wet hair, bruised cheek, blood, torn clothes, holding object, empty if none" });
        return fields;
    }

    async function liUpdateCharacterStateTags(li, charKey, s, assignment, btn = null, options = {}) {
        ensureStructuredCharacterAssignment(assignment);
        const refreshFields = getRefreshableStateFields(li, assignment);
        if (refreshFields.length === 0) {
            if (!options.silent) toastr.warning("No enabled state fields to refresh for this character.");
            return false;
        }
        const chatText = getRecentVisualContext(2);
        if (chatText.length < 20) {
            if (!options.silent) toastr.warning("Not enough recent chat to update visual state.");
            return false;
        }

        const originalHtml = btn ? btn.html() : "";
        if (btn) btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i>');

        try {
            if (li.useDanbooruTags) await loadDanbooruTags();

            activeLoraStateUpdateRequest = {
                chatText,
                character: assignment.character || "",
                match_keywords: assignment.match_keywords || "",
                refreshFields,
                current: {
                    clothing_tags: assignment.clothing_tags || "",
                    pose_expression_tags: assignment.pose_expression_tags || "",
                    current_state_tags: assignment.current_state_tags || ""
                }
            };

            let rawOutput;
            if (s.generatorBackend === "direct") {
                rawOutput = await generateQuietPrompt({ prompt: "___PS_LORA_STATE_UPDATE___" });
            } else {
                let presetResult;
                await useMeguminEngine(async () => {
                    presetResult = await generateQuietPrompt({ prompt: "___PS_LORA_STATE_UPDATE___" });
                });
                rawOutput = presetResult;
            }

            activeLoraStateUpdateRequest = null;
            rawOutput = stripUtilityThinkingWrapper(rawOutput || "").trim();
            if (!rawOutput) {
                toastr.warning("AI returned empty state update.");
                return;
            }

            li.lastCharacterAnalysisResponse = rawOutput;
            $("#li_last_analysis_body").val(rawOutput);

            let jsonText = rawOutput;
            let jsonMatch = jsonText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                const trimmed = jsonText.trim();
                if (trimmed.startsWith('"')) {
                    jsonText = `{${trimmed}`;
                    if (!jsonText.trim().endsWith('}')) jsonText = jsonText.trim() + '}';
                    jsonMatch = jsonText.match(/\{[\s\S]*\}/);
                }
            }
            if (!jsonMatch) {
                toastr.warning("State update response was not valid JSON.");
                saveProfileToMemory();
                return;
            }

            const update = JSON.parse(jsonMatch[0]);
            refreshFields.map(f => f.key).forEach(key => {
                if (update[key] === undefined) return;
                const repairedTags = danbooruTagsMap && danbooruTagsMap.size > 0 ? repairBooruTags(update[key]) : update[key];
                assignment[key] = normalizeGeneratedTagField(repairedTags);
            });
            normalizeStructuredCharacterAssignment(assignment);

            saveProfileToMemory();
            if (!options.skipRender) liRenderAssignmentTable(li, charKey, s);
            if (!options.silent) toastr.success("Updated current visual tags.");
            return true;
        } catch (e) {
            if (!options.silent) toastr.error("State update failed.");
            console.error(e);
            return false;
        } finally {
            activeLoraStateUpdateRequest = null;
            if (btn) btn.prop("disabled", false).html(originalHtml);
        }
    }

    async function liRefreshActiveCharacterStates(li, charKey, s, btn) {
        ensureLoraIntelDefaults(li);
        const assignments = getActiveCharacterAssignments(li, charKey);
        if (assignments.length === 0) return toastr.warning("No active character assignments to refresh.");

        const refreshable = assignments.filter(a => getRefreshableStateFields(li, a).length > 0);
        if (refreshable.length === 0) return toastr.warning("No enabled state fields to refresh.");

        const originalHtml = btn.html();
        btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> Refreshing...');
        let updated = 0;
        try {
            for (const assignment of refreshable) {
                const ok = await liUpdateCharacterStateTags(li, charKey, s, assignment, null, { silent: true, skipRender: true });
                if (ok) updated++;
            }
            saveProfileToMemory();
            liRenderAssignmentTable(li, charKey, s);
            if (updated > 0) toastr.success(`Refreshed ${updated} active character state${updated === 1 ? "" : "s"}.`);
            else toastr.warning("No character states were refreshed.");
        } finally {
            btn.prop("disabled", false).html(originalHtml);
        }
    }

    function shouldUseStructuredCharacterBlocks(s, li) {
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

    async function generateImagePromptText() {
        const s = getLocalProfile().imageGen;
        const li = s.loraIntel;

        const chat = getContext().chat;
        const charKey = getCharacterKey() || "default";

        const lastMessages = chat.filter(m => !m.is_system).slice(-5).map(m => {
            const text = cleanMessageTextForKeywords(m.mes);
            return `${m.name}: ${text.trim()}`;
        }).join("\n\n");

        const booruStd = isBooruStandardImageMode(s, li);
        const booruStableLeadPrepend = buildBooruStandardTagLead(s, li);
        const structuredMode = shouldUseStructuredCharacterBlocks(s, li);
        const matchedAssignments = structuredMode ? getMatchedCharacterAssignments(li, charKey) : [];
        const structuredBlocks = structuredMode && matchedAssignments.length > 0;
        const structuredActionReference = structuredBlocks ? buildStructuredCharacterActionReference(matchedAssignments) : "";

        let styleStr;
        if (structuredBlocks) {
            styleStr = "Structured Anima prompt planning. Output ONLY key-value lines for scene/action planning, not the final prompt. Required keys: background, composition, and one '<slot> action' line for each listed character slot. Do not output character appearance, clothing, series, known character tags, story character names, JSON, markdown, bullets, or explanations.";
        } else if (s.promptStyle === "illustrious") {
            styleStr = "Use Danbooru-style tags separated by commas.";
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
        if (li && li.enabled && li.useDanbooruTags && !structuredBlocks && s.promptStyle !== "sdxl" && !booruStd) {
            styleStr += " For Anima, use lowercase tags with spaces instead of underscores, escape literal parentheses in known character/series tags (example: saber \\(fate\\)), and do not combine story character names with look-alike tags.";
        }

        let perspStr = s.promptPerspective === "pov" ? "Frame the scene strictly from a First-Person (POV) perspective." : (s.promptPerspective === "character" ? "Focus intensely on the character's appearance." : "Describe the entire environment and atmosphere.");

        let extraStr = "None";
        if (booruStd) {
            const extraParts = [];
            const pe = (s.promptExtra && s.promptExtra.trim()) ? s.promptExtra.trim() : "";
            if (pe) {
                extraParts.push(
                    booruStableLeadPrepend
                        ? `Scene tags and cues (from the user's Extra field, often comma-separated shorthand). Interpret and weave into your flowing description; translate into prose where needed. Do not paste this block unchanged as a prefix or suffix—the only automatic prefix is the separate \"leading tags\" field.\n${pe}`
                        : `Scene tags and cues (from the user's Extra field, often comma-separated shorthand). Interpret and weave into your flowing description; translate into prose where needed.\n${pe}`
                    );
            }
            if (structuredActionReference) {
                extraParts.push(`Character slots: ${structuredActionReference}. Output lines like "background: ...", "composition: ...", and "${getCharacterSlotLabel(0, matchedAssignments.length)} action: ...". Keep actions/poses/placement only.`);
            } else if (li && li.enabled) {
                const matchedBooru = getMatchedBooruTags(li, charKey);
                if (matchedBooru.length > 0) {
                    const booruInstr = matchedBooru.map(m => `${m.character}: ${m.tags}`).join(' | ');
                    extraParts.push(`Character appearance cues (Danbooru-style tags per role). Weave into your flowing description: translate into prose (face, hair, eyes, figure, clothing, any named character look-alike tag). Do not emit them as a comma-separated prefix or block.\n${booruInstr}`);
                }
            }
            if (extraParts.length > 0) extraStr = extraParts.join("\n\n");
        } else {
            extraStr = s.promptExtra || "None";
            if (structuredActionReference) {
                extraStr += `\nCharacter slots: ${structuredActionReference}. Output lines like "background: ...", "composition: ...", and "${getCharacterSlotLabel(0, matchedAssignments.length)} action: ...". Keep actions/poses/placement only.`;
            } else if (li && li.enabled) {
                const matchedBooru = getMatchedBooruTags(li, charKey);
                if (matchedBooru.length > 0) {
                    const booruInstr = matchedBooru.map(m => `${m.character}: ${m.tags}`).join(' | ');
                    if (s.promptStyle === "sdxl") {
                        extraStr += `\nCharacter appearance shorthand (per role). Fold ONLY into flowing English prose—translate hair, eyes, figure, outfit, and any look-alike references; NEVER output as comma tags, underscores, or token lists: ${booruInstr}`;
                    } else {
                        extraStr += `\nCharacter appearance tags by role. Use these as Anima-style comma tags with spaces instead of underscores. Keep known character/series tags exact and escaped when they have parentheses. Do not combine story names with look-alike tags: ${booruInstr}`;
                    }
                }
            }
        }

        activeImageGenRequest = { chatText: lastMessages, styleStr: styleStr, perspStr: perspStr, extraStr: extraStr };

        let rawOutput = await generateQuietPrompt({ prompt: "___PS_IMAGE_GEN___" });
        let finalPrompt = stripUtilityThinkingWrapper(rawOutput);
        if (s.promptStyle === "illustrious") {
            finalPrompt = stripPreambleBeforeBooruTags(finalPrompt);
        }

        if (structuredBlocks && matchedAssignments.length > 0) {
            finalPrompt = buildStructuredKeyValuePrompt({ s, li, sceneText: finalPrompt, assignments: matchedAssignments });
        } else {
            finalPrompt = normalizeAnimaGeneratedTags(sanitizePromptTags(finalPrompt));
        }

        return { prompt: finalPrompt, skipLeadPrefix: structuredBlocks && matchedAssignments.length > 0 };
    }

    async function igGenerateWithComfy(positivePrompt, target = null, opts = null) {
        const s = getLocalProfile().imageGen;
        ensureImageGenLoraArrays(s);
        igSyncImageGenLoraFromDom(s);
        let raw = stripUtilityThinkingWrapper(String(positivePrompt ?? ""));
        if (s.promptStyle === "illustrious") {
            raw = stripPreambleBeforeBooruTags(raw);
        }
        const rawSceneText = raw;
        let finalPrompt = sanitizePromptTags(raw);
        if (opts && opts.normalizeGeneratedPrompt) {
            finalPrompt = normalizeAnimaGeneratedTags(finalPrompt);
        }
        let builtStructuredPrompt = false;
        if (opts && opts.appendStructuredCharacterBlocks) {
            const li = s.loraIntel;
            const charKey = getCharacterKey() || "default";
            const matchedAssignments = shouldUseStructuredCharacterBlocks(s, li) ? getMatchedCharacterAssignments(li, charKey) : [];
            if (matchedAssignments.length > 0) {
                finalPrompt = buildStructuredKeyValuePrompt({ s, li, sceneText: rawSceneText, assignments: matchedAssignments });
                builtStructuredPrompt = true;
            }
        }
        if (!builtStructuredPrompt && (!opts || !opts.skipLeadPrefix)) {
            finalPrompt = ensureImageLeadPrefix(finalPrompt);
        }

        // --- INTERCEPT PROMPT IF PREVIEW IS ENABLED ---
        if (s.previewPrompt) {
            $("#kazuma_progress_overlay").hide(); // Hide the progress bar temporarily

            const $content = $(`
                <div style="display:flex; flex-direction:column; gap:10px; font-family: 'Inter', sans-serif;">
                    <div style="font-size: 0.85rem; color: var(--text-muted);">Review or modify the prompt before it goes to ComfyUI.</div>
                    <textarea class="ps-modern-input ig-preview-textarea" style="height: 150px; resize: vertical; font-family: monospace; font-size: 0.85rem; padding: 10px;">${finalPrompt}</textarea>
                </div>
            `);

            // CRITICAL FIX: SillyTavern destroys the popup HTML when it closes.
            // We MUST capture the text while the user is typing!
            let liveText = finalPrompt;
            $content.find(".ig-preview-textarea").on("input", function() {
                liveText = $(this).val();
            });

            const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Preview Image Prompt", { okButton: "Send to ComfyUI", cancelButton: "Cancel", wide: true });
            const confirmed = await popup.show();

            if (!confirmed) {
                toastr.info("Generation cancelled.");
                return;
            }

            finalPrompt = liveText.trim();
            if (!finalPrompt) return toastr.warning("Prompt cannot be empty.");

            showKazumaProgress("Preparing to Render..."); // Bring progress bar back
        }

        let workflowRaw;
        try {
            const res = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: s.currentWorkflowName }) });
            if (!res.ok) throw new Error("Load failed"); workflowRaw = await res.json();
        } catch (e) { return toastr.error(`Could not load ${s.currentWorkflowName}`); }

        let workflow = (typeof workflowRaw === 'string') ? JSON.parse(workflowRaw) : workflowRaw;
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
        if (li && li.enabled && li.ensureLoras && li.characterAssignments && li.characterAssignments[charKey]) {
            ensureImageGenLoraArrays(s);
            const locked = s.loraSlotLocked;
            const kwManaged = s.loraSlotKeywordManaged;

            const activeAssignments = getActiveCharacterAssignments(li, charKey);

            const occupiedKeys = new Set();
            slots.forEach((sl, idx) => {
                if (!sl || sl === "None" || sl === "") return;
                if (locked[idx]) occupiedKeys.add(normalizeLoraKeyForDedupe(sl));
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
                if (locked[i] || !kwManaged[i]) continue;
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

        const comfyRepl = {
            "%prompt%": finalPrompt,
            "%negative_prompt%": s.customNegative || "",
            "%seed%": finalSeed,
            "%sampler%": s.selectedSampler || "euler",
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

        igLastComfyApiRequest = igBuildLastComfyApiSnapshot(s, workflow, finalPrompt, finalSeed, l1, l2, l3, l4, w1, w2, w3, w4);
        igRefreshLastComfyApiPanel();

        try {
            const res = await fetch(`${s.comfyUrl}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow }) });
            if(!res.ok) throw new Error("Failed");
            const data = await res.json();

            showKazumaProgress("Rendering Image...");
            const checkInterval = setInterval(async () => {
                try {
                    const h = await (await fetch(`${s.comfyUrl}/history/${data.prompt_id}`)).json();
                    if (h[data.prompt_id]) {
                        clearInterval(checkInterval);
                        let finalImage = null;
                        for (const nodeId in h[data.prompt_id].outputs) {
                            const nodeOut = h[data.prompt_id].outputs[nodeId];
                            if (nodeOut.images && nodeOut.images.length > 0) { finalImage = nodeOut.images[0]; break; }
                        }
                        if (finalImage) {
                            showKazumaProgress("Downloading...");
                            const imgUrl = `${s.comfyUrl}/view?filename=${finalImage.filename}&subfolder=${finalImage.subfolder}&type=${finalImage.type}`;

                            // Download & Compress
                            const response = await fetch(imgUrl); const blob = await response.blob();
                            const base64Raw = await new Promise((res) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(blob); });
                            let base64Clean = base64Raw; let format = "png";
                            if (s.compressImages) {
                                base64Clean = await new Promise((res) => { const img = new Image(); img.src = base64Raw; img.onload = () => { const cvs = document.createElement('canvas'); cvs.width = img.width; cvs.height = img.height; cvs.getContext('2d').drawImage(img, 0, 0); res(cvs.toDataURL("image/jpeg", 0.9)); }; img.onerror = () => res(base64Raw); });
                                format = "jpeg";
                            }

                            // Insert to Chat
                            const charName = getContext().characters[getContext().characterId]?.name || "User";
                            const savedPath = await saveBase64AsFile(base64Clean.split(',')[1], charName, `${charName}_${humanizedDateTime()}`, format);
                            const mediaAttach = {
                                url: savedPath,
                                type: "image",
                                source: "generated",
                                title: finalPrompt,
                                generation_type: "free"
                            };

                            if (target && target.message) {
                                if (!target.message.extra) target.message.extra = {}; if (!target.message.extra.media) target.message.extra.media =[];
                                target.message.extra.media_display = "gallery"; target.message.extra.media.push(mediaAttach); target.message.extra.media_index = target.message.extra.media.length - 1;
                                if (typeof appendMediaToMessage === "function") appendMediaToMessage(target.message, target.element);
                                await saveChat(); toastr.success("Gallery updated!");
                            } else {
                                const newMsg = { name: "Image Gen Kazuma", is_user: false, is_system: true, send_date: Date.now(), mes: "", extra: { media: [mediaAttach], media_display: "gallery", media_index: 0 }, force_avatar: "img/five.png" };
                                getContext().chat.push(newMsg); await saveChat();
                                if (typeof addOneMessage === "function") addOneMessage(newMsg); else await reloadCurrentChat();
                                toastr.success("Image inserted!");
                            }
                            $("#kazuma_progress_overlay").hide();
                        } else { $("#kazuma_progress_overlay").hide(); }
                    }
                } catch (e) {}
            }, 1000);
        } catch(e) { $("#kazuma_progress_overlay").hide(); toastr.error("Comfy Error: " + e.message); }
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
            let shouldInject = false;
            let conditionalText = "";
            const mode = ig.triggerMode || "always";

            if (mode === "always") shouldInject = true;
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
                const promptUsesStructuredBlocks = shouldUseStructuredCharacterBlocks(ig, igLi) && getMatchedCharacterAssignments(igLi, charKeyImg).length > 0;

                const booruStableLead = buildBooruStandardTagLead(ig, igLi);

                let styleStr = ig.promptStyle === "illustrious" ? "Use Danbooru-style tags. Focus on anime." : (ig.promptStyle === "sdxl" ? "Inside the <img prompt=\"\"> value: SDXL natural prose ONLY—fluent English in full sentences. FORBIDDEN: comma-separated tag dumps, Danbooru underscores, 1girl-style shorthand, lists of keywords. Translate any listed cues into description." : "Use keywords.");
                if (promptUsesStructuredBlocks) {
                    styleStr = "Inside the <img prompt=\"\"> value, output ONLY key-value lines for scene/action planning, not the final prompt. Required keys: background, composition, and one '<slot> action' line for each listed character slot. Do not output character appearance, clothing, series, known character tags, story character names, JSON, markdown, bullets, or explanations.";
                } else if (booruStd) {
                    styleStr = "Inside the image prompt, write ONLY flowing natural-language (full sentences, not booru tag lists). Turn shorthand into prose—for example \"1girl, blue eyes, huge breasts\" → \"a woman with blue eyes and huge breasts.\" Describe actions and poses clearly. Do NOT repeat the opening tag block listed below; only the mandatory leading-tag prefix is supplied separately—your part is prose only. If Extra lists scene cues or character-appearance Danbooru tags below, weave them into that prose (translate to natural description; do not duplicate as a raw tag list).";
                } else if (ig.promptStyle === "sdxl" && booruStableLead) {
                    styleStr += " Do NOT repeat the comma-separated mandatory leading-tag prefix listed below; your attribute value is prose only, after that prefix is applied by the pipeline.";
                }
                if (igLi && igLi.enabled && igLi.useDanbooruTags && igLi.promptAssemblyMode !== 'structured' && ig.promptStyle !== "sdxl" && !booruStd) {
                    styleStr += " For Anima, use lowercase tags with spaces instead of underscores, escape literal parentheses in known character/series tags (example: saber \\(fate\\)), and do not combine story character names with look-alike tags.";
                }
                let perspStr = ig.promptPerspective === "pov" ? "First-Person (POV)." : (ig.promptPerspective === "character" ? "Focus on character appearance." : "Describe environment.");

                let liInstructions = "";
                if (igLi && igLi.enabled) {
                    const li = igLi;
                    {
                        const structuredBlocks = promptUsesStructuredBlocks;
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
                                    if (loraEntry && loraEntry.keywords && loraEntry.keywords.length > 0) {
                                        kwStrings.push(`${a.character}: ${loraEntry.keywords.join(', ')}`);
                                    }
                                }
                                const tagBlock = getAssignmentTagBlock(a, li) || a.booru_tags;
                                if (li.useDanbooruTags && tagBlock && !structuredBlocks) {
                                    booruStrings.push(`${a.character}: ${tagBlock}`);
                                }
                                if (li.useCharDescriptions && a.description) {
                                    descStrings.push(`${a.character}: ${a.description}`);
                                }
                            });

                            if (kwStrings.length > 0) {
                                liInstructions += `\nInclude these activation keywords for the following characters: ${kwStrings.join(' | ')}`;
                            }
                            if (structuredBlocks) {
                                liInstructions += `\nCharacter action slots: ${buildStructuredCharacterActionReference(activeAssignments)}. Inside the <img prompt=""> value, use these slot labels only for actions, poses, placement, and expressions. Do not output story character names. Do not output, copy, summarize, or rewrite character appearance tags, clothing tags, series tags, or known character tags; the app appends exact character tags after generation.`;
                            }
                            if (booruStrings.length > 0) {
                                if (booruStd) {
                                    liInstructions += `\nCharacter appearance (per role); merge into your flowing prose naturally—do not paste as a comma tag block after the mandatory prefix: ${booruStrings.join(' | ')}`;
                                } else if (ig.promptStyle === "sdxl") {
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

                const peTrim = (ig.promptExtra && ig.promptExtra.trim()) ? ig.promptExtra.trim() : "";
                const extraLine = peTrim
                    ? (booruStd
                        ? `\nExtra (scene tags and cues—integrate into your flowing prose; translate shorthand to natural language; do not duplicate the mandatory leading-tag prefix):\n${peTrim}`
                        : (ig.promptStyle === "sdxl"
                            ? `\nExtra (scene cues—translate into flowing English inside the prompt; no comma-tag or underscore fragments):\n${peTrim}`
                            : `\nExtra (tags / instructions to keep as comma-separated tags): ${peTrim}`))
                    : "";
                const tagLeadLine = booruStableLead
                    ? (promptUsesStructuredBlocks
                        ? ""
                        : (ig.promptStyle === "sdxl"
                        ? `\nReference leading tags (the app prepends these; do NOT paste them into the attribute—write prose only inside prompt=\"\"): ${booruStableLead}`
                        : `\nMandatory tag prefix (copy exactly at the start of the prompt value, then comma, then your prose): ${booruStableLead}`))
                    : "";

                dict["[[img1]]"] = `[IMAGE GENERATION]\n${conditionalText}Style: ${styleStr}\nPerspective: ${perspStr}${extraLine}${tagLeadLine}${liInstructions}`;
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
            messages.length = 0;
            messages.push({
                "role": "system",
                "content": "You are an expert AI image prompt engineer. Read the scene and output exactly ONE image prompt. Obey Style Constraint and Camera Perspective. STRICTLY FORBIDDEN: apologies, preambles, plans, meta commentary (e.g. \"I need to\", \"I'll craft\"), reasoning, bullet lists, <thinking> or <think> blocks, XML, markdown, or chat references. Your entire reply must be nothing except the raw prompt text."
            });
            messages.push({
                "role": "user",
                "content": `Write an image generation prompt for the latest scene in this chat history.\n\n<chat>\n${activeImageGenRequest.chatText}\n</chat>\n\nStyle Constraint: ${activeImageGenRequest.styleStr}\nCamera Perspective: ${activeImageGenRequest.perspStr}\nExtra Details: ${activeImageGenRequest.extraStr}\n\nOutput ONLY the raw prompt text. No other words before or after.`
            });
        if (!disablePrefill) {
            messages.push({
                "role": "assistant",
                "content": "Understood.\n"
            });
        }

            console.log(`[${extensionName}] 🎯 Injected Image Gen array in memory.`);
            return true;
        }

        // --- INJECT LORA STATE UPDATE PROMPT ---
        if (activeLoraStateUpdateRequest) {
            messages.length = 0;
            const refreshFields = activeLoraStateUpdateRequest.refreshFields || [
                { key: "clothing_tags", label: "clothing_tags", hint: "current outfit/accessory tags only" },
                { key: "pose_expression_tags", label: "pose_expression_tags", hint: "current pose/expression/action tags only" },
                { key: "current_state_tags", label: "current_state_tags", hint: "temporary state tags only, such as wet hair, bruised cheek, blood, torn clothes, holding object, empty if none" }
            ];
            const currentFieldLines = refreshFields.map(f => `Current ${f.key}: ${activeLoraStateUpdateRequest.current[f.key] || ""}`).join("\n");
            const jsonShape = refreshFields.map(f => `  "${f.key}": "${f.hint}"`).join(",\n");
            const fieldNames = refreshFields.map(f => f.key).join(", ");
            messages.push({
                "role": "system",
                "content": "You update temporary visual metadata for image generation. Return exactly one JSON object and nothing else. Never update permanent identity, body, face, hair, eye color, known character tags, series tags, or match keywords."
            });
            messages.push({
                "role": "user",
                "content": `Update only these enabled temporary visual tag fields for this character using the latest chat: ${fieldNames}.\n\n<character>\nName: ${activeLoraStateUpdateRequest.character || "Unknown"}\nMatch keywords: ${activeLoraStateUpdateRequest.match_keywords || "None"}\n${currentFieldLines}\n</character>\n\n<latest_chat>\n${activeLoraStateUpdateRequest.chatText}\n</latest_chat>\n\nReturn this exact JSON shape:\n{\n${jsonShape}\n}\n\nRules:\n- Use concise Danbooru-style comma-separated tags.\n- Do not include disabled fields in the JSON.\n- Do not include permanent physical traits like hair color, eye color, body type, or character identity.\n- Do not include story character names.\n- If a field is not clear from the latest chat, keep the existing field value.\n- Output ONLY the JSON object.`
            });
            if (!disablePrefill) {
                messages.push({
                    "role": "assistant",
                    "content": "{\n"
                });
            }
            console.log(`[${extensionName}] Injected LoRA state update array in memory.`);
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
                jsonFormat += `, "character_tag": "known_character_tag_or_empty", "series_tag": "series_tag_or_empty", "physical_tags": "hair/eyes/body tags", "clothing_tags": "outfit/accessory tags", "action_tags": "default action/interaction tags", "pose_expression_tags": "default pose/expression tags", "current_state_tags": "temporary visual state tags", "plain_description": "natural language visual description"`;
                let booruInstr = "You MUST provide Danbooru-style tag fields for each character. Put stable look-alike identity tags in character_tag, series/franchise tags in series_tag, body/face/hair/eyes in physical_tags, outfit/accessories in clothing_tags, default action/interaction in action_tags, default pose/expression in pose_expression_tags, and temporary scene-specific visual state in current_state_tags. Also provide plain_description as a detailed natural-language visual description. ";
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

            messages.push({
                "role": "system",
                "content": `You are an expert at analyzing roleplay conversations and extracting character visual metadata for image generation. ${modeInstructions}`
            });
            messages.push({
                "role": "user",
                "content": `Analyze this conversation and extract visual metadata for the important characters.\n\n<chat>\n${activeLoraAssignRequest.chatText}\n</chat>${loraSection}\n\nReturn a JSON array with this exact format:\n[\n${jsonFormat}\n]\n\nRules:\n- Output ONLY the JSON array, no explanation`
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
            toastr.info("Image tag detected. Sending to ComfyUI...");
            igGenerateWithComfy(extractedPrompt, null, { normalizeGeneratedPrompt: true, appendStructuredCharacterBlocks: true });
        }, 500);
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
            if (!mediaObj || !mediaObj.title) return;

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
            await igGenerateWithComfy(mediaObj.title, { message: message, element: $(element) });
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
        registerImageSwipeHandler,
    };
}
