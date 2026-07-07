import { Router, type IRouter, type Request, type Response } from "express";
import { db, playerSavesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface SaveSync {
  coins: number;
  ownedSabers: number[];
  equippedSaber: number;
  maxLevel: number;
  bestScore: number;
}

function isValidPlayerId(id: string): boolean {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

function isValidCode(code: string): boolean {
  return typeof code === "string" && /^[A-Z0-9]{6}$/.test(code);
}

function parseOwnedSabers(raw: string): number[] {
  try {
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) {
      const filtered = arr.filter((x) => Number.isInteger(x) && x >= 1 && x <= 20);
      return filtered.length > 0 ? filtered.sort((a, b) => a - b) : [1];
    }
  } catch {
    // fall through
  }
  return [1];
}

function clampSync(s: Partial<SaveSync>): SaveSync {
  const ownedSabers = Array.isArray(s.ownedSabers)
    ? s.ownedSabers.filter((t) => Number.isInteger(t) && t >= 1 && t <= 20)
    : [1];
  if (!ownedSabers.includes(1)) ownedSabers.unshift(1);
  return {
    coins: Math.max(0, Math.floor(s.coins ?? 0)),
    ownedSabers: ownedSabers.sort((a, b) => a - b),
    equippedSaber: Math.max(1, Math.floor(s.equippedSaber ?? 1)),
    maxLevel: Math.max(1, Math.floor(s.maxLevel ?? 1)),
    bestScore: Math.max(0, Math.floor(s.bestScore ?? 0)),
  };
}

function mergeSyncs(a: SaveSync, b: SaveSync): SaveSync {
  const ownedSabers = Array.from(new Set([...a.ownedSabers, ...b.ownedSabers]))
    .filter((t) => Number.isInteger(t) && t >= 1)
    .sort((x, y) => x - y);
  if (!ownedSabers.includes(1)) ownedSabers.unshift(1);

  const equippedSaber = ownedSabers.includes(b.equippedSaber)
    ? b.equippedSaber
    : ownedSabers[ownedSabers.length - 1];

  return {
    coins: Math.max(a.coins, b.coins),
    ownedSabers,
    equippedSaber,
    maxLevel: Math.max(a.maxLevel, b.maxLevel),
    bestScore: Math.max(a.bestScore, b.bestScore),
  };
}

function rowToSync(row: {
  coins: number; ownedSabers: string; equippedSaber: number;
  maxLevel: number; bestScore: number;
}): SaveSync {
  return {
    coins: row.coins,
    ownedSabers: parseOwnedSabers(row.ownedSabers),
    equippedSaber: row.equippedSaber,
    maxLevel: row.maxLevel,
    bestScore: row.bestScore,
  };
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function upsertSave(playerId: string, sync: SaveSync): Promise<void> {
  await db
    .insert(playerSavesTable)
    .values({
      playerId,
      coins: sync.coins,
      ownedSabers: JSON.stringify(sync.ownedSabers),
      equippedSaber: sync.equippedSaber,
      maxLevel: sync.maxLevel,
      bestScore: sync.bestScore,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: playerSavesTable.playerId,
      set: {
        coins: sync.coins,
        ownedSabers: JSON.stringify(sync.ownedSabers),
        equippedSaber: sync.equippedSaber,
        maxLevel: sync.maxLevel,
        bestScore: sync.bestScore,
        updatedAt: new Date(),
      },
    });
}

const router: IRouter = Router();

router.get("/saves/:playerId", async (req: Request, res: Response) => {
  const { playerId } = req.params as { playerId: string };
  if (!isValidPlayerId(playerId)) {
    res.status(400).json({ error: "invalid player id" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(playerSavesTable)
      .where(eq(playerSavesTable.playerId, playerId))
      .limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(rowToSync(rows[0]));
  } catch (err) {
    res.status(500).json({ error: "database error" });
  }
});

router.put("/saves/:playerId", async (req: Request, res: Response) => {
  const { playerId } = req.params as { playerId: string };
  if (!isValidPlayerId(playerId)) {
    res.status(400).json({ error: "invalid player id" });
    return;
  }
  const body = req.body as Partial<SaveSync>;
  if (typeof body !== "object" || body === null) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const incoming = clampSync(body);
  try {
    const existing = await db
      .select()
      .from(playerSavesTable)
      .where(eq(playerSavesTable.playerId, playerId))
      .limit(1);
    const merged = existing.length > 0
      ? mergeSyncs(rowToSync(existing[0]), incoming)
      : incoming;
    await upsertSave(playerId, merged);
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: "database error" });
  }
});

router.post("/saves/:playerId/link-code", async (req: Request, res: Response) => {
  const { playerId } = req.params as { playerId: string };
  if (!isValidPlayerId(playerId)) {
    res.status(400).json({ error: "invalid player id" });
    return;
  }
  try {
    const existing = await db
      .select()
      .from(playerSavesTable)
      .where(eq(playerSavesTable.playerId, playerId))
      .limit(1);

    if (existing.length > 0 && existing[0].linkCode) {
      res.json({ code: existing[0].linkCode });
      return;
    }

    let code = "";
    for (let attempts = 0; attempts < 10; attempts++) {
      code = generateCode();
      const conflict = await db
        .select({ playerId: playerSavesTable.playerId })
        .from(playerSavesTable)
        .where(eq(playerSavesTable.linkCode, code))
        .limit(1);
      if (conflict.length === 0) break;
    }

    if (existing.length > 0) {
      await db
        .update(playerSavesTable)
        .set({ linkCode: code })
        .where(eq(playerSavesTable.playerId, playerId));
    } else {
      await db.insert(playerSavesTable).values({
        playerId,
        coins: 0,
        ownedSabers: "[1]",
        equippedSaber: 1,
        maxLevel: 1,
        bestScore: 0,
        linkCode: code,
        updatedAt: new Date(),
      });
    }

    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: "database error" });
  }
});

router.post("/saves/link/:code", async (req: Request, res: Response) => {
  const { code } = req.params as { code: string };
  if (!isValidCode(code.toUpperCase())) {
    res.status(400).json({ error: "invalid code format" });
    return;
  }
  const body = req.body as { playerId?: string } & Partial<SaveSync>;
  const callerPlayerId = typeof body.playerId === "string" ? body.playerId : null;

  try {
    const codeRows = await db
      .select()
      .from(playerSavesTable)
      .where(eq(playerSavesTable.linkCode, code.toUpperCase()))
      .limit(1);

    if (codeRows.length === 0) {
      res.status(404).json({ error: "code not found" });
      return;
    }

    const canonicalRow = codeRows[0];
    const canonicalSync = rowToSync(canonicalRow);

    const callerSync = callerPlayerId ? clampSync(body) : null;
    const merged = callerSync ? mergeSyncs(canonicalSync, callerSync) : canonicalSync;

    await db
      .update(playerSavesTable)
      .set({
        coins: merged.coins,
        ownedSabers: JSON.stringify(merged.ownedSabers),
        equippedSaber: merged.equippedSaber,
        maxLevel: merged.maxLevel,
        bestScore: merged.bestScore,
        updatedAt: new Date(),
      })
      .where(eq(playerSavesTable.playerId, canonicalRow.playerId));

    res.json({
      playerId: canonicalRow.playerId,
      ...merged,
    });
  } catch (err) {
    res.status(500).json({ error: "database error" });
  }
});

export default router;
