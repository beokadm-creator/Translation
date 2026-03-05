async function check() {
    try {
        const response = await fetch('https://translation-comm-default-rtdb.firebaseio.com/projects/hall/stream.json?orderBy="timestamp"&limitToLast=2');
        const data = await response.json();
        console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(e);
    }
}
check();
