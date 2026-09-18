const ALLOWED = [
  "query", "diet", "intolerances", "cuisine", "type",
  "maxReadyTime", "offset", "includeIngredients", "sort"
];

const cache = new Map();
const TTL = 1000 * 60 * 30;

function slim(r) {
  const instr = Array.isArray(r.analyzedInstructions) ? r.analyzedInstructions : [];
  const steps = instr.length && Array.isArray(instr[0].steps)
    ? instr[0].steps.map(s => s.step).filter(Boolean)
    : [];
  return {
    id: r.id,
    title: r.title,
    image: r.image || "",
    time: r.readyInMinutes || null,
    servings: r.servings || null,
    source: r.sourceUrl || r.spoonacularSourceUrl || "",
    credit: r.sourceName || r.creditsText || "",
    vegan: !!r.vegan,
    vegetarian: !!r.vegetarian,
    glutenFree: !!r.glutenFree,
    dairyFree: !!r.dairyFree,
    diets: r.diets || [],
    dishTypes: r.dishTypes || [],
    cuisines: r.cuisines || [],
    ingredients: (r.extendedIngredients || []).map(i => ({
      a: i.amount, u: i.unit || "", n: i.originalName || i.name || "", o: i.original || ""
    })),
    steps: steps
  };
}

module.exports = async (req, res) => {
  const key = process.env.SPOONACULAR_KEY;
  if (!key) {
    return res.status(500).json({
      error: "The server has no API key set. Add SPOONACULAR_KEY in your project's environment variables and redeploy."
    });
  }

  const p = new URLSearchParams();
  for (const k of ALLOWED) {
    const v = req.query[k];
    if (v !== undefined && v !== null && String(v).length) {
      p.set(k, String(v).slice(0, 300));
    }
  }
  p.set("addRecipeInformation", "true");
  p.set("fillIngredients", "true");
  p.set("instructionsRequired", "true");
  p.set("number", "24");
  if (!p.get("sort")) p.set("sort", "popularity");

  const ck = p.toString();
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.t < TTL) {
    res.setHeader("x-cache", "HIT");
    return res.status(200).json(hit.d);
  }

  try {
    const upstream = await fetch(
      "https://api.spoonacular.com/recipes/complexSearch?" + ck,
      { headers: { "x-api-key": key } }
    );

    if (!upstream.ok) {
      const body = await upstream.text();
      const msg = upstream.status === 402
        ? "Today's recipe quota is used up. It resets at midnight UTC."
        : upstream.status === 401
          ? "The API key was rejected. Check SPOONACULAR_KEY in your environment variables."
          : "The recipe service returned an error.";
      return res.status(upstream.status).json({ error: msg, detail: body.slice(0, 200) });
    }

    const data = await upstream.json();
    const out = {
      total: data.totalResults || 0,
      offset: data.offset || 0,
      results: (data.results || []).map(slim)
    };

    cache.set(ck, { t: Date.now(), d: out });
    if (cache.size > 400) cache.delete(cache.keys().next().value);

    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=1800");
    res.setHeader("x-cache", "MISS");
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "Could not reach the recipe service. Try again in a moment." });
  }
};
