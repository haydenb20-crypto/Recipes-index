const cache = new Map();
const TTL = 1000 * 60 * 30;

module.exports = async (req, res) => {
  const key = process.env.SPOONACULAR_KEY;
  if (!key) return res.status(500).json({ error: "The server has no API key set." });

  const id = String(req.query.id || "");
  if (!/^\d{1,9}$/.test(id)) return res.status(400).json({ error: "Bad recipe id." });

  const hit = cache.get(id);
  if (hit && Date.now() - hit.t < TTL) return res.status(200).json(hit.d);

  try {
    const upstream = await fetch(
      `https://api.spoonacular.com/recipes/${id}/information?includeNutrition=false`,
      { headers: { "x-api-key": key } }
    );
    if (!upstream.ok) {
      const msg = upstream.status === 402
        ? "Today's recipe quota is used up. It resets at midnight UTC."
        : "Could not load that recipe.";
      return res.status(upstream.status).json({ error: msg });
    }
    const r = await upstream.json();
    const instr = Array.isArray(r.analyzedInstructions) ? r.analyzedInstructions : [];
    const out = {
      id: r.id,
      steps: instr.length && Array.isArray(instr[0].steps)
        ? instr[0].steps.map(s => s.step).filter(Boolean)
        : [],
      ingredients: (r.extendedIngredients || []).map(i => ({
        a: i.amount, u: i.unit || "", n: i.originalName || i.name || "", o: i.original || ""
      })),
      source: r.sourceUrl || "",
      credit: r.sourceName || r.creditsText || ""
    };
    cache.set(id, { t: Date.now(), d: out });
    if (cache.size > 800) cache.delete(cache.keys().next().value);
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=1800");
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "Could not reach the recipe service." });
  }
};
