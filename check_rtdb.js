
const url = 'https://translation-comm-default-rtdb.firebaseio.com/projects/hall/stream.json?orderBy="timestamp"&limitToLast=5';

async function check() {
    try {
        const response = await fetch(url);
        const data = await response.json();
        console.log(JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

check();
