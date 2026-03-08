
const url = 'https://translation-comm-default-rtdb.firebaseio.com/projects/hall.json';

async function check() {
    try {
        const response = await fetch(url);
        const data = await response.json();

        console.log('--- Project Information (hall) ---');
        console.log('Active Session ID:', data.activeSessionId);

        if (data.activeSessionId && data.sessions && data.sessions[data.activeSessionId]) {
            const session = data.sessions[data.activeSessionId];
            console.log('Session Details:');
            console.log('  Speaker:', session.speaker);
            console.log('  Source Language:', session.sourceLanguage);
            console.log('  Status:', session.status);
        } else {
            console.log('No active session found or session data missing.');
        }

        console.log('Settings:', JSON.stringify(data.settings || {}, null, 2));
        console.log('State:', JSON.stringify(data.state || {}, null, 2));

        // Check for recent stream entries
        if (data.stream) {
            const streamEntries = Object.entries(data.stream)
                .sort((a, b) => (b[1] as any).timestamp - (a[1] as any).timestamp)
                .slice(0, 3);
            console.log('Recent Stream Entries:', JSON.stringify(streamEntries, null, 2));
        }
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

check();
