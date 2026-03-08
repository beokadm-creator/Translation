
const url = 'https://translation-comm-default-rtdb.firebaseio.com/projects/hall.json';

async function check() {
    try {
        const response = await fetch(url);
        const data = await response.json();
        const activeSessionId = data.activeSessionId;
        const session = data.sessions?.[activeSessionId];
        const state = data.state;
        const settings = data.settings;

        console.log('--- Project Information ---');
        console.log('Active Session ID:', activeSessionId);
        console.log('Session Language:', session?.sourceLanguage || 'en');
        console.log('Session Topic:', session?.topic || 'N/A');
        console.log('Chunk Settings:', JSON.stringify(settings?.chunk || {}, null, 2));
        console.log('Buffer State:', JSON.stringify(state || {}, null, 2));
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

check();
