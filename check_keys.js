
const url = 'https://translation-comm-default-rtdb.firebaseio.com/projects/hall.json?shallow=true';

async function check() {
    try {
        const response = await fetch(url);
        const data = await response.json();
        console.log('Keys in projects/hall:', Object.keys(data));
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

check();
