import 'dotenv/config';
import supabase from './config/supabaseClient.js';

async function deleteCoda() {
  console.log('Deleting Coda integration record for user 23331303-1918-41b3-9db4-482668fc695d...');
  const { error } = await supabase
    .from('user_integrations')
    .delete()
    .eq('user_id', '23331303-1918-41b3-9db4-482668fc695d')
    .eq('platform_name', 'coda');
    
  if (error) {
    console.error('DB delete error:', error.message);
  } else {
    console.log('Coda integration record successfully deleted! You can now click "Connect Coda" again on the onboarding page.');
  }
}

deleteCoda();
