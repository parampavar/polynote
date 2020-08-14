import {Observer, StateHandler} from "./state_handler";

test("setting the state updates observers", done => {
    const sh = new StateHandler(1);
    sh.addObserver((next, prev) => {
        expect(prev).toBe(1);
        expect(next).toBe(2);
        done()
    });
    sh.updateState(() => 2)
});

test("updating the state updates observers", done => {
    const sh = new StateHandler(1);
    sh.addObserver((next, prev) => {
        expect(prev).toBe(1);
        expect(next).toBe(2);
        done()
    });
    sh.updateState(() => 2)
});

test("views are updated by parent state changes", done => {
    const sh = new StateHandler({key: 1, otherKey: "something"});
    const viewKey = sh.view("key");
    const viewOtherKey = sh.view("otherKey")
    const gotOtherKey = new Promise(resolve => {
        viewOtherKey.addObserver((next, prev) => {
            expect(prev).toBe("something");
            expect(next).toBe("nothing");
            resolve()
        })
    })
    sh.updateState(s => {
        return {
            ...s,
            otherKey: "nothing"
        }
    })
    gotOtherKey.then(_ => {
        const promise = new Promise(resolve => {
            viewKey.addObserver((next: number, prev: number) => {
                expect(prev).toBe(1);
                expect(next).toBe(2);
                resolve()
            });
        })
        sh.updateState(s => {
            return {
                ...s,
                key: 2
            }
        })
        return promise
    }).then(_ => {
        expect(viewKey.getState()).toBe(sh.getState().key)
    }).then(_ => done())
});

test("views can be passed a constructor", done => {
    const sh = new StateHandler({key: 1});
    class AddingStorageHandler extends StateHandler<number> {
        readonly someProperty: number = 100;
        constructor( initial: number) {
            super(initial);
        }

        updateState(f: (s: number) => number) {
            const add1 = (s: number) => f(s) + 1;
            super.updateState(add1);
        }
    }
    const shV = sh.view("key", AddingStorageHandler);
    expect(shV.someProperty).toBe(100);
    expect(shV instanceof AddingStorageHandler).toBeTruthy();
    sh.addObserver((next: {key: number}, prev: {key: number}) => {
        expect(prev.key).toBe(1);
        expect(next.key).toBe(3);
        done()
    });
    shV.updateState(() => 2);
    expect(shV.getState()).toBe(sh.getState().key)
});

test("mapview can be used to view a modified value", done => {
    const sh = new StateHandler({key: 1});
    const toT = (s: number) => s.toString();
    const fromT = (s: number, t: string) => parseInt(t);
    const shV = sh.mapView("key", toT);
    sh.addObserver((next: {key: number}, prev: {key: number}) => {
        expect(prev.key).toBe(1);
        expect(next.key).toBe(2);
        done()
    });
    sh.updateState(() => ({key: 2}));
    expect(shV.getState()).toBe(toT(sh.getState().key))
});

test("stress test", () => {
    const state = {
        key: {
            key2: {
                values: <number[]> []
            }
        }
    }
    const sh = new StateHandler(state);
    const view1 = sh.view("key")
    const view2 = sh.view("key").view("key2")
    const view3 = view1.view("key2");


    [...Array(500).keys()].forEach(x => {
        sh.updateState(s => {
            return {
                ...s,
                key: {
                    ...s.key,
                    key2: {
                        ...s.key.key2,
                        values: [...s.key.key2.values, x]
                    }
                }
            }
        })
    })
    console.log(sh.getState())
    console.log(sh.getState().key.key2)
})

test("tmp", done => {

    // type Observer<S> = (key: keyof S, current: S[keyof S], previous: S[keyof S]) => void;
    type HasObservers<S> = {
        observers: Map<keyof S, Observer<S[keyof S]>[]>,
        addObserver(key: keyof S, f: Observer<S[keyof S]>): Observer<S[keyof S]>,
        removeObserver(key: keyof S, f: Observer<S[keyof S]>): void,
        clearObservers(): void,
    }
    const HasObservers = <S>() => {
        let observers: Map<keyof S, Observer<S[keyof S]>[]> = new Map();
        return <HasObservers<S>>{
            observers: observers,
            addObserver(key: keyof S, f: Observer<S[keyof S]>): Observer<S[keyof S]> {
                const maybeObs = observers.get(key);
                if (maybeObs) {
                    maybeObs.push(f);
                } else {
                    observers.set(key, [f]);
                }
                return f;
            },
            removeObserver(key: keyof S, f: Observer<S[keyof S]>): void {
                if (observers.has(key)) {
                    const idx = observers.get(key)!.indexOf(f);
                    if (idx >= 0) {
                        observers.get(key)!.splice(idx, 1)
                    }
                }
            },
            clearObservers(): void {
                observers.clear()
            },
        }
    }
    type State<S extends object> = S & HasObservers<S>
    function StateHandler<S extends object>(obj: S): State<S>{
        const withObservers =  Object.assign(obj, HasObservers<S>())
        return new Proxy(withObservers, new ProxyStateHandler<State<S>>())
    }

    class ProxyStateHandler<S extends object> implements ProxyHandler<State<S>>{
        private children: Record<keyof S, S[keyof S]>
        get(target: State<S>, p: keyof S): any {
            let prop = target[p];
            if (this.isObject(prop)) {
                // TODO: use cache the Proxies in a WeakMap rather than creating a new one every time: https://hacks.mozilla.org/2015/07/es6-in-depth-proxies-and-reflect/
                const foundProxy = this.children[p]
                if (foundProxy) {
                    return foundProxy
                } else {
                    const proxy = new Proxy(prop, new ProxyStateHandler())
                    this.children[p] = proxy
                    return proxy
                }
            } else {
                return prop;
            }
        }

        set(target: State<S>, p: keyof S, newState: State<S>[keyof S]): boolean {
            const oldState = Reflect.get(target, p)
            if (oldState) {
                target[p] = newState;
                target.observers.get(p)?.forEach(obs => {
                    obs(newState, oldState)
                })
                return true;
            } else {
                return false
            }
        }

        isObject(obj: any): obj is object {
            return obj && typeof obj === "object" && !Array.isArray(obj)
        }

    }

    type Foo = { key: { key2: { values: number[] } } }
    const state: Foo = {
        key: {
            key2: {
                values: [1, 2, 3, 4]
            }
        }
    }
    const s = StateHandler(state)
    s.addObserver("key", (x, y) => {
        console.log("current", x)
        console.log("prev", y)
        done()
    })
    s.key = { key2: { values: [5]}}
    // s.key.key2.values.push(5)

})