import 'dotenv/config';
import supabase from '../config/supabaseClient.js';

async function inspect() {
  console.log('--- Inspecting Supabase DB Connection & Schema ---');
  try {
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*');
    
    if (usersError) {
      console.error('Error fetching users:', usersError);
    } else {
      console.log(`Successfully fetched users. Total rows: ${users.length}`);
      console.log('Users:', JSON.stringify(users, null, 2));
    }

    const { data: events, error: eventsError } = await supabase
      .from('learning_events')
      .select('*')
      .limit(5);

    if (eventsError) {
      console.error('Error fetching learning_events:', eventsError);
    } else {
      console.log(`Successfully fetched learning_events. Total rows/sample count: ${events.length}`);
    }

    const { data: cards, error: cardsError } = await supabase
      .from('spaced_repetition_cards')
      .select('*')
      .limit(5);

    if (cardsError) {
      console.error('Error fetching spaced_repetition_cards:', cardsError);
    } else {
      console.log(`Successfully fetched spaced_repetition_cards. Total rows/sample count: ${cards.length}`);
    }

  } catch (err) {
    console.error('Inspection failed with exception:', err);
  }
}

inspect();
