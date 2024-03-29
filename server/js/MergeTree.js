function MergeTree() {
    this.nodeLookup = {};
    this.root = null;
    this.tree = new Tree();
    this.mergeCommits = [];
    this.children = {};
}

// Asynchronous download of commits, returns promise either responding or rejecting
MergeTree.prototype.downloadCommits = function(url) {
    return new Promise(function(resolve, reject){
        request({
            url: url,
            success: resolve,
            error: function(e) {reject(Error(e));}});
    });
}

// This should be handled inside of our download commits function
MergeTree.prototype.populateTable = function(commits) {
    var mergeTree = this;
    return new Promise(function(resolve, reject) {
        for (var commit of commits) {
            mergeTree.nodeLookup[commit.hash] = commit;
        }
        mergeTree.mergeCommits = commits.filter(function(val) { return val.parents.length > 1;}).map(function(val) { return val.hash; });
        resolve(mergeTree);
    });
}

// Phase 1, find the children of nodes that are important
MergeTree.prototype.phase1 = async function(mergetree, rootHash) {
    let depth = 0;
    let nodeQueue = new Queue();
    let children = {};
    let depths = {};
    let promise_to_hash = new Map();
    let visited = new Set();

    nodeQueue.push(new Promise(function(resolve, reject){ resolve(rootHash);}));
    mergetree.root = new TreeNode(rootHash);
    depths[rootHash] = 0;

    do {
        let cur = await nodeQueue.pop();
        let parentList = mergetree.nodeLookup[cur].parents.map(function(par, idx){
            let retPromis = new Promise(function(resolve, reject){
                if (!(par.hash in depths)) {
                    // TODO: Check that this is minimized, we want the min of this
                    // and what it might be. -- Also need to check all children of
                    // this and update depths accordingly
                    depths[par.hash] = depths[cur] + idx;
                } else if (depths[cur] > depths[par.hash]) {
                    depth--;
                } else if (depths[cur] < depths[par.hash]) {
                    depths[par.hash] = depths[cur];
                    depth--; // Will be off by at most one for each parent to make up for the old base parent
                }
                // Add current as child of parent if not already a child
                if (par.hash in children) {
                    if (!children[par.hash].includes(cur)) children[par.hash].push(cur);
                } else children[par.hash] = [cur];
                // If we have downloaded the commit, resolve immediately,
                // otherwise, download it
                if (par.hash in mergetree.nodeLookup) resolve(par.hash);
                else {
                    mergetree.downloadCommits(par.links.self.href)
                        .then(function(ret){ return mergetree.populateTable([ret]);})
                        .then(function() {resolve(par.hash);});
                }
            });
            promise_to_hash.set(retPromis, par.hash);
            return retPromis;
        });

        depth += (parentList.length != 0) ? (parentList.length - 1) : 0;
        parentList.forEach(function(item) {
            if (!visited.has(promise_to_hash.get(item))) {
                nodeQueue.push(item);
                visited.add(promise_to_hash.get(item));
            }
        });
    } while (nodeQueue.size() > 0 && depth != 0);
    mergetree.children = children;

    // assign final depths to nodes
    for (key in depths) mergetree.nodeLookup[key].depth = depths[key];
    return mergetree;
}

// Phase 2: Takes the children and arranges them into a tree
MergeTree.prototype.phase2 = async function(mergetree) {

    mergetree.tree.add(mergetree.root);
    var mtree = mergetree;
    let nodeQueue = new Queue();

    // First iteration
    let cur = mergetree.root;
    let parentList = mergetree.nodeLookup[cur.key].parents.map(function(par) { return par.hash; });
    parentList.shift(); // Remove the next commit on the master branch
    parentList.forEach(function(item){
        let newNode = new TreeNode(item);
        let realParent = mergetree.children[item]
            .filter(function(child) {return mergetree.nodeLookup[item].depth >= mergetree.nodeLookup[child].depth;})
            .reduce(function(a, b) { return mergetree.nodeLookup[a].depth > mergetree.nodeLookup[b].depth ? b : a; });
        if (realParent == cur.key) {
            cur.children.push(newNode);
            newNode.parent = cur;
            nodeQueue.push(newNode);
        }
    })

    // Children of that, if there are any
    while (nodeQueue.size() > 0) {
        let cur = nodeQueue.pop();
        let parentList = mergetree.nodeLookup[cur.key].parents.map(function(par) { return par.hash; });
        parentList.forEach(function(item){
            let newNode = new TreeNode(item);
            let realParent = mergetree.children[item]
                .filter(function(child) {return mergetree.nodeLookup[item].depth >= mergetree.nodeLookup[child].depth;})
                .reduce(function(a, b) { return mergetree.nodeLookup[a].depth > mergetree.nodeLookup[b].depth ? b : a; });
                // Parents can't be deeper than their children, we want the one that
                // is closest in depth to the item
            if (realParent == cur.key) {
                cur.children.push(newNode);
                newNode.parent = cur;
                nodeQueue.push(newNode);
            }
        })
    }
    return mergetree;
}
