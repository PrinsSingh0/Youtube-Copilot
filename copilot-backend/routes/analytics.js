// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — ANALYTICS & REVIEWS CONTROLLER (routes/analytics.js)
// ==============================================================================
import express from 'express';
import supabase from '../config/supabaseClient.js';
import { verifySupabaseJWT } from '../middleware/auth.js';
import sysLogger from '../config/logger.js';

const router = express.Router();

/**
 * Task C.1: Server-Side SuperMemo-2 Optimization Endpoint
 * POST /api/reviews/submit
 */
router.post('/reviews/submit', verifySupabaseJWT, async (req, res) => {
  const { cardId, score } = req.body;
  if (cardId === undefined || score === undefined) {
    return res.status(400).json({ error: 'cardId and score are required parameters.' });
  }

  const q = parseInt(score, 10);
  if (isNaN(q) || q < 0 || q > 5) {
    return res.status(400).json({ error: 'score must be an integer between 0 and 5 inclusive.' });
  }

  try {
    // Fetch the flashcard
    const { data: card, error: fetchError } = await supabase
      .from('spaced_repetition_cards')
      .select('*')
      .eq('id', cardId)
      .eq('user_id', req.user.id)
      .single();

    if (fetchError || !card) {
      sysLogger.error('SM-2: Failed to retrieve card', { cardId, userId: req.user.id, error: fetchError?.message });
      return res.status(404).json({ error: 'Flashcard not found.' });
    }

    const n = card.repetitions || 0;
    const EF = parseFloat(card.ease_factor) || 2.50;
    const I = card.review_interval_days || 0;

    let nextReps = n;
    let nextInterval = I;

    // Apply SuperMemo-2 algorithm scheduling rules
    if (q >= 3) {
      if (n === 0) {
        nextInterval = 1;
      } else if (n === 1) {
        nextInterval = 6;
      } else {
        nextInterval = Math.round(I * EF);
      }
      nextReps = n + 1;
    } else {
      nextReps = 0;
      nextInterval = 1;
    }

    // Calculate updated Ease Factor
    let nextEF = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (nextEF < 1.3) {
      nextEF = 1.3;
    }

    // Round EF to 2 decimal places (numeric(4,2))
    nextEF = Math.round(nextEF * 100) / 100;

    // Calculate next review date (today + nextInterval days)
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + nextInterval);
    const nextReviewDateStr = nextReview.toISOString().split('T')[0];

    // Persist card stats
    const { data: updatedCard, error: updateError } = await supabase
      .from('spaced_repetition_cards')
      .update({
        repetitions: nextReps,
        ease_factor: nextEF,
        review_interval_days: nextInterval,
        next_review_date: nextReviewDateStr,
        updated_at: new Date().toISOString()
      })
      .eq('id', cardId)
      .select()
      .single();

    if (updateError) throw updateError;

    sysLogger.info('SM-2: Flashcard review processed', {
      cardId,
      userId: req.user.id,
      score: q,
      nextReps,
      nextInterval,
      nextEF,
      nextReviewDate: nextReviewDateStr
    });

    return res.status(200).json({
      success: true,
      card: updatedCard
    });
  } catch (err) {
    sysLogger.error('SM-2 Error [/api/reviews/submit]', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Task C.2: Spaced Repetition Flashcard Queue Provider Route
 * GET /api/reviews/queue
 */
router.get('/reviews/queue', verifySupabaseJWT, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: cards, error } = await supabase
      .from('spaced_repetition_cards')
      .select('*')
      .eq('user_id', req.user.id)
      .lte('next_review_date', today)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      queue: cards
    });
  } catch (err) {
    sysLogger.error('Queue Error [/api/reviews/queue]', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});
export default router;
