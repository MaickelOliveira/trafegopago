import {describe,expect,it} from "vitest";
import {markSent,consumeSent,markPhoneSending,isPhoneSending} from "../whatsapp-sent";
describe("provider echo isolation",()=>{
 it("does not mistake a human message on another connection for our own sent text",()=>{markSent("5544999999999","fixture","instance-a");expect(consumeSent("5544999999999","fixture","instance-b")).toBe(false);expect(consumeSent("5544999999999","fixture","instance-a")).toBe(true);expect(consumeSent("5544999999999","fixture","instance-a")).toBe(false);});
 it("limits the echo window to two events on the selected connection",()=>{markPhoneSending("5544999999999","instance-a");expect(isPhoneSending("5544999999999","instance-b")).toBe(false);expect(isPhoneSending("5544999999999","instance-a")).toBe(true);expect(isPhoneSending("5544999999999","instance-a")).toBe(true);expect(isPhoneSending("5544999999999","instance-a")).toBe(false);});
});
