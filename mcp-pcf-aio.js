'Strict mode'

const spawnSync = require('node:child_process').spawnSync; //used to get list of i2c buses
const i2cModule = require('i2c-bus'); // https://github.com/fivdi/i2c-bus
const process = require('process'); //used in line 8
const performance = require('perf_hooks').performance; //only performance.now() is used

process.on('uncaughtException', (err, origin) => {
    console.error( "!!! Unhandled error in MCP230XX/PCF857X node-red module.   >> " + err + "   >> ORIGIN: " + origin );
});

debugger

module.exports = function(RED) {
    //****** SETUP SECTION ******/
    const busStateTexts = [ //used in catch(err)
        "Opening i2c Bus",			// processState 0 ... actually this is done only virtually, the opening happens only at first read/write
        "Reading current state",	// processState 1
        "Writing byte",				// processState 2
        "Closing i2c bus"];			// processState 3

    const log2console = true; // enable to show detailed logs in:  node-red-log
    const timerLog   = false; // !! WARNING !!   << if true, will fill up the log with ALL read events (up to 50x3 msg. per sec !! if read interval is 20ms)
    
    // *** THESE REGISTER ADDRESSES ARE ONLY RELEVANT FOR MCP230xx CHIPS; PCF857x(A) CHIPS DO NOT HAVE REGISTERS TO SET ***/
    // IOCON.BANK = 0 << !!! Non-Bank mode: Using this is NOT USED HERE..
    const BNK0_IODIR_A		= 0x00;
    const BNK0_IODIR_B		= 0x01;
    const BNK0_IPOL_A		= 0x02;
    const BNK0_IPOL_B		= 0x03;
    const BNK0_GPINTEN_A	= 0x04;
    const BNK0_GPINTEN_B	= 0x05;
    const BNK0_DEFVAL_A		= 0x06;
    const BNK0_DEFVAL_B		= 0x07;
    const BNK0_INTCON_A		= 0x08;
    const BNK0_INTCON_B		= 0x09;
    const BNK0_IOCON_A		= 0x0A;
    const BNK0_IOCON_B		= 0x0B;
    const BNK0_GPPU_A		= 0x0C;
    const BNK0_GPPU_B		= 0x0D;
    const BNK0_INTF_A		= 0x0E;
    const BNK0_INTF_B		= 0x0F;
    const BNK0_INTCAP_A		= 0x10;
    const BNK0_INTCAP_B		= 0x11;
    const BNK0_GPIO_A		= 0x12;
    const BNK0_GPIO_B		= 0x13;
    const BNK0_OLAT_A		= 0x14;
    const BNK0_OLAT_B		= 0x15;

    // IOCON.BANK = 1 << BANK MODE: THIS IS WHAT THIS PROGRAM USES
    // MCP23008 only uses Bank A (register addresses 0X00 - 0X0A); MCP23017 uses both Banks A and B
    //Bank A:
    const BNK1_IODIR_A   = 0x00; //< Defines the direction of a port: Input/Output.
    const BNK1_IPOL_A    = 0x01; //< Sets the polarity inversion of input ports: GPIO register bit equals inverted input or not.
    const BNK1_GPINTEN_A = 0x02; //< Controls the interrupt-on-change for each input.
    const BNK1_DEFVAL_A  = 0x03; //< Sets the input comparison value: interrupt will only occur if input differs from corresponding DEFVAL bit
    const BNK1_INTCON_A  = 0x04; //< Controls whether input is compared to previous value or to DEFVAL register value before firing an interrupt.
    const BNK1_IOCON_A   = 0x05; //< Controls the device. (0, INTPOL, ODR, HAEN, DISSLW, SEQOP, MIRROR, BANK)
    const BNK1_GPPU_A    = 0x06; //< Controls engagement of the input pull-up resistors for the input pins.
    const BNK1_INTF_A    = 0x07; //< Identifies the input that led to the interrupt condition.
    const BNK1_INTCAP_A  = 0x08; //< Captures the input value at the time the interrupt occurred.
    const BNK1_GPIO_A    = 0x09; //< Reflects the value on all pins: outputs and (inverted) inputs.
    const BNK1_OLAT_A    = 0x0A; //< Provides access to the output latches.

    //Bank B
    const BNK1_IODIR_B   = 0x10; //< Defines the direction of a port: Input/Output.
    const BNK1_IPOL_B    = 0x11; //< Sets the polarity inversion of input ports: GPIO register bit equals inverted input or not.
    const BNK1_GPINTEN_B = 0x12; //< Controls the interrupt-on-change for each input.
    const BNK1_DEFVAL_B  = 0x13; //< Sets the input comparison value: interrupt will only occur if input differs from corresponding DEFVAL bit
    const BNK1_INTCON_B  = 0x14; //< Controls whether input is compared to previous value or to DEFVAL register value before firing an interrupt.
    const BNK1_IOCON_B   = 0x15; //< Controls engagement of the input pull-up resistors for the input pins.
    const BNK1_GPPU_B    = 0x16; //< Controls engagement of the input pull-up resistors for the input pins.
    const BNK1_INTF_B    = 0x17; //< Identifies the input that led to the interrupt condition.
    const BNK1_INTCAP_B  = 0x18; //< Captures the input value at the time the interrupt occurred.
    const BNK1_GPIO_B    = 0x19; //< Reflects the value on all pins: outputs and (inverted) inputs.
    const BNK1_OLAT_B    = 0x1A; //< Provides access to the output latches.

    // *** Bit manipulation helper functions:
    //Get bit
    function getBit(number, bitPosition) {
        return (number & (1 << bitPosition)) === 0 ? 0 : 1;
    }   
    //Set Bit
    function setBit(number, bitPosition) {
        return number | (1 << bitPosition);
    }
    //Clear Bit
    function clearBit(number, bitPosition) {
        const mask = ~(1 << bitPosition);
        return number & mask;
    }
    //Update Bit
    function updateBit(number, bitPosition, bitValue) {
        const bitValueNormalized = bitValue ? 1 : 0;
        const clearMask = ~(1 << bitPosition);
        return (number & clearMask) | (bitValueNormalized << bitPosition);
    }
    //****** END SETUP SECTION ******/

    //****** NODE STATUS SECTION ******/
    function showStatus (_obj, _onOffStatus, _errorStatus) {
        // _errorStatus:  if address is already in use or a global error occurred while trying read/write to the chip	
        if (log2console) console.log("    ...status update >>  _onOffStatus: " + _onOffStatus +"   globalState= "+ _errorStatus + "  Node_id=" + _obj.id);

        if ((_errorStatus >= 2) || (_onOffStatus == -2)) { // ERROR  !
            // it is impossible to determine if an i2c bus exists and works, so the whole chip is set to "error state"
            _obj.status({fill:"red"   ,shape:"dot" ,text:"! Error." + _errorStatus >= 2 ? " Re-test:" + _errorStatus + "sec" : ""});
        } else {
            if (_errorStatus == 0) { // Uninitialized
                _obj.status({fill:"yellow",shape:"ring",text:"unknown yet"});
            } else {
                if (_errorStatus == 1) { // Working :-)
                    const _onOff = _onOffStatus;
                    //const _onOff = _obj.invert ? !_onOffStatus : _onOffStatus;
                    if (_onOff == true) {
                        _obj.status({fill:"green" ,shape:"dot" ,text:"On"});
                    } else
                    if (_onOff == false){
                        _obj.status({fill:"grey"  ,shape:"ring",text:"Off"});
                    }
                }
            }
        }
    }
    //****** END NODE STATUS SECTION ******/

    //****** MAIN CHIP CREATION ******/
    function mcp_pcf_chipNode(n) {
        RED.nodes.createNode(this, n);
        var mainChipNode = this;

        this.chipType       = n.chipType;
        this.busNum         = parseInt(n.busNum, 10); // converts string to decimal (10)
        this.addr           = parseInt(n.addr  , 16); // converts from HEXA (16) string to decimal 
        this.maxBits        =(this.chipType==="MCP23017" || this.chipType==="PCF8575") ? 16 : 8;
        this.isInputs       = 0x0000;	// keeps track of input ports (saved in hexadecimal form)
        this.pullUps        = 0x0000;   // keeps track of pullUps (not relevant for PCF chips)
        this.startAllHIGH   = n.startAllHIGH; // Some relay boards use negative logic (HIGH = OFF) << ab1do: only relevant for MCP chips: PCF chips default to HIGH
        this.ids            = new Array(this.maxBits).fill(null); //depending on chiptype, 8 or 16 element null array
        this.globalState    = 0;  // 0=uninitialized  1=working: on/off=see:ids    2=error
        this.errorCount		= 0;
        this.allStates  	= -1; // 0x1111;
        this.lastTimeRead   = 0;  // when was the last time a successfull full 8/16bit READ operation happened (inputs only)
        this.readLength		= 0;  // how long did the last read sequence take (inputs)(ms)

        // Timer related variables:
        this.interval       = 0 + n.interval;
        this.origInterv     = this.interval;
        this.chipTimer      = null;
        this.timerIsRunning = false;

        if (log2console) console.log("  "+this.chipType+" chip initialization OK. BusNumber=" + this.busNum + " Address=0X" + this.addr.toString(16) + "  id:" + this.id+"  startAllHigh = "+this.startAllHIGH); 
        
        /*   ### INITIALIZATION of the Chip ###   */
        /*   ##################################   */ 
        this.initializeBit = function(_bitNum, _isInput, _pullUp, _callerNode){ //< Only _bitNum and _callerNode relevant for PCF chips
            const _parCh = _callerNode.parentChip;			
            var ip1, ip2;
            if (log2console) console.log("    "+_parCh.chipType+" init-Pin started... i2cAddr = 0X" + _parCh.addr.toString(16) + "  pinNum=" + _bitNum + "  isInput=" + _isInput + "  pullUp=" + _pullUp + "  startAllHigh=" + _parCh.startAllHIGH + "  LastState="+ _callerNode.lastState);

            if (_parCh.ids[_bitNum] != null ) {//<<< ab1do: May not need anymore, now that client disallows creation of more than 1 node using same pin on a chip
                if (log2console) console.log("!!MCP chip-node-ids[_bitNum] != null: a node is ALREADY connected to this pin:" + _parCh.ids[_bitNum]);
                if (_parCh.ids[_bitNum] != _callerNode.id) { 
                    if (log2console) console.log("!!MCP chip-node-ids[_bitNum] != _callerNode.id =" + _callerNode.id);
                    _callerNode.lastState = -2; 	// error state
                    showStatus(_callerNode, -2, 2); // show red error status at the corner of the Node
                    _callerNode.error("!!MCP/PCF pin is already used by another node: Bit=" + _bitNum + " Bus=" + _parCh.busNum + " Addr = 0X" + _parCh.addr.toString(16) + " ID=" + _parCh.ids[_bitNum]); 					
                    return false;
                }
            }

            for (var i=0; i < _parCh.maxBits; i++){ //NEED TO REMOVE ANY OTHER REFERENCES TO THIS ID  (maxBits= 8 or 16)
                if (_parCh.ids[i] == _callerNode.id)  { _parCh.ids[i] = null; }
            }            
            _parCh.ids[_bitNum] = _callerNode.id; // remember which pin (bitNum) this Node is assigned to. 			
            let _processState = 0;

            try {
                let aBus = i2cModule.openSync(_parCh.busNum);//<< ab1do: .openSync by default does not allow access to i2cbus if bus is already in use.
                switch(_parCh.chipType) {
                    case ("PCF8574"): case("PCF8574A"):
                        // Check if need to Turn On ALL pins at start               
                        if ((_parCh.startAllHIGH == true) && (_callerNode.lastState = -2)){ // unnecessary? According to datasheet, PCF857X by default start all high.
                            if (log2console) console.log("    "+_parCh.chipType+" Now Setting ALL output pins to HIGH; Addr = 0X" + _parCh.addr.toString(16));
                            _parCh.allStates = 0xFF;
                        } else {
                            _parCh.allStates = aBus.receiveByteSync(_parCh.addr);
                        }
                        if (_isInput) {_parCh.isInputs = _parCh.isInputs |  (1 << _bitNum)} //identify input nodes
                        else {_parCh.isInputs = _parCh.isInputs & ~(1 << _bitNum)} //...or outputs
                        _parCh.allStates =_parCh.allStates | _parCh.isInputs; // bitwise OR allStates of chip with isInputs to change only output nodes
                        aBus.sendByteSync(_parCh.addr, _parCh.allStates); //update chip with modified allStates: changes only output pins
                        if(this.interval == undefined || this.interval == 0 ) {this.reviewStates(true,false)} //if not polling, read once to set input according input value
                        if (log2console) console.log("    "+_parCh.chipType+" First READ OK; allStates=" + _parCh.allStates.toString(2).padStart(8,"0"));
                    break;
                    case("PCF8575"):
                        // Check if need to Turn On ALL pins at start
                        if ((_parCh.startAllHIGH == true) && (_callerNode.lastState = -2)){
                            if (log2console) console.log("    PCF8575 Now Setting ALL output pins to HIGH; Addr = 0X" + _parCh.addr.toString(16));
                            _parCh.allStates = 0xFFFF;
                        } else {
                            _parCh.allStates = aBus.readWordSync(_parCh.addr,_parCh.addr);//<<< RECEIVES 2 BYTES: LSB followed by MSB
                        } 
                        if (_isInput) {_parCh.isInputs = _parCh.isInputs |  (1 << _bitNum)}
                        else {_parCh.isInputs = _parCh.isInputs & ~(1 << _bitNum)}
                        _parCh.allStates =_parCh.allStates | _parCh.isInputs;
                        aBus.writeWordSync(_parCh.addr, _parCh.allStates & 0xFF,(_parCh.allStates>>8) & 0xFF);//update chip with modified allStates (LSB then MSB)
                        if(this.interval == undefined || this.interval == 0 ) {this.reviewStates(true,false)} //if not polling, read once to set input nodes according their input values
                        if (log2console) console.log("    PCF8575 First READ OK; allStates=" + _parCh.allStates.toString(2).padStart(16,"0"));
                    break;
                    // End PCF chip
                    case("MCP23017"):
                        function bbb () { // this proc. is only for testing
                            let bank0 = -1;  let bank1 = -1; 
                            bank0 = aBus.readByteSync(_parCh.addr, BNK0_IOCON_B);
                            bank1 = aBus.readByteSync(_parCh.addr, BNK1_IOCON_A);

                            console.log("************** Bank IOCON_B_BNK0=" + bank0.toString(2) + "  *********  Bank IOCON_A_BNK1=" + bank1.toString(2));
                            console.log("**** A0=" + aBus.readByteSync(_parCh.addr, BNK0_OLAT_A).toString(2) + "   B0=" + aBus.readByteSync(_parCh.addr, BNK0_OLAT_B).toString(2));
                            console.log("**** A1=" + aBus.readByteSync(_parCh.addr, BNK1_OLAT_A).toString(2) + "   B1=" + aBus.readByteSync(_parCh.addr, BNK1_OLAT_B).toString(2));
                        }
                        //bbb();     
                        aBus.writeByteSync(_parCh.addr, BNK0_IOCON_B, 0xA0); //Only has effect if MCP23017 is not in Bank mode (BNK0_IOCON_B address does not
                        // exist if MCP23017 already in Bank mode)  See:Page-17 TABLE 3-4 of MCP23017 datasheet PDF
                        //bbb();

                        // IOCON: keep chip in Bank mode:                     bit7 BANK   ->1
                        //        functionally OR BankA/BankB interrupts:     bit6 MIRROR ->1
                        //        disable address pointer auto-increment:     bit5 SEQOP  ->1
                        //        enable SDA slew rate control:               bit4 DISSLEW->0
                        //        HAEN only relevant for SPI version of chip: bit3 HAEN   ->x
                        //        interrupt output as open drain:             bit2 ODR    ->1 (if instead active interrupt ->0)
                        //        if ODR, then INTPOL not relevant:           bit1 INTPOL ->x (otherwise active high->1, active low->0)
                        //        bit 0 ignored:                              bit0        ->x
                        //        11100100 = 0xE4
                        aBus.writeByteSync(_parCh.addr, BNK1_IOCON_A, 0xE4); // See:Page-17 TABLE 3-4 of MCP23017 datasheet PDF
                        //bbb();

                        _processState = 2;

                        // Check if need to Turn On ALL pins at start
                        if ((_parCh.startAllHIGH == true) && (_callerNode.lastState = -2)) {
                            if (log2console) console.log("MCP23017 Now Setting ALL pins to HIGH. A+B = 1111111111111111 Addr = 0X" + _parCh.addr.toString(16));
                            aBus.writeByteSync(_parCh.addr, BNK1_OLAT_A, 0xFF);	//Set output A to 11111111 (LSB)
                            aBus.writeByteSync(_parCh.addr, BNK1_OLAT_B, 0xFF);	//Set output B to 11111111 (MSB)
                            _parCh.allStates 	= 0xFFFF; // 16 bit: Bank-A GPIO 0-7 + Bank-B GPIO 0-7 shifted up (LSB+MSB)
                        }
                        if (_parCh.allStates = -1) {
                            ip1 = aBus.readByteSync(_parCh.addr, BNK1_GPIO_A); //read PortA GPIO pins (LSB)
                            ip2 = aBus.readByteSync(_parCh.addr, BNK1_GPIO_B); //read PortB GPIO pins (MSB)
                            _parCh.lastTimeRead = performance.now();
                            ip2 = (ip2 << 8); //shift ip2 up to MSB of 16 bit combined PortA and PortB values
                            _parCh.allStates = ip1 + ip2; // combine ip1 and up-shifted ip2 to form 16 bit word;
                        }
                        if (log2console) console.log("    MCP23017 First READ OK; A="+ip1.toString(2).padStart(16,"0")+" B="+ip2.toString(2).padStart(16,"0")+" allStates=" + _parCh.allStates.toString(2).padStart(16,"0"));
                    
                        // Set Registers
                        // _parCh.isInputs determines which pins are inputs (IODIR = 1) or outputs (IODIR = 0)
                        if (_isInput)	 {_parCh.isInputs = _parCh.isInputs |  (1 << _bitNum);}// input: e.g. if _bitNum = 5, shift 1 left 5, then bitwise or with whatever _parCh.isInputs is makes pin 5 an input
                        else			 {_parCh.isInputs = _parCh.isInputs & ~(1 << _bitNum);}//output: e.g. if _bitNum = 5, shift 1 left 5, then bitwise and (not bit5) with whatever _parCh.isInputs is makes pin 5 an output

                        if (_bitNum < 8) {aBus.writeByteSync(_parCh.addr, BNK1_IODIR_A,  _parCh.isInputs       & 0xFF);} //update in/out mode A
                        else			 {aBus.writeByteSync(_parCh.addr, BNK1_IODIR_B, (_parCh.isInputs >> 8) & 0xFF);} //update in/out mode B
                        
                        if (_isInput) {
                            if (_pullUp)  { _parCh.pullUps  = _parCh.pullUps  | (1 << _bitNum) } else { _parCh.pullUps  = _parCh.pullUps  & ~(1 << _bitNum) };

                            if (log2console) console.log("    MCP23017 Input pullups=" + _parCh.pullUps);

                            if (_bitNum < 8)	{aBus.writeByteSync(_parCh.addr, BNK1_GPPU_A ,    _parCh.pullUps        & 0xFF);} //set internal pull-up 100K resistor A
                            else				{aBus.writeByteSync(_parCh.addr, BNK1_GPPU_B ,   (_parCh.pullUps  >> 8) & 0xFF);} //set internal pull-up 100K resistor B
                            if (_bitNum < 8)	{aBus.writeByteSync(_parCh.addr, BNK1_IPOL_A, 0x00);} //disable Input invert(=POLarity) A
                            else				{aBus.writeByteSync(_parCh.addr, BNK1_IPOL_B, 0x00);} //disable Input invert(=POLarity) B
                            if (_bitNum < 8)	{aBus.writeByteSync(_parCh.addr, BNK1_GPINTEN_A,  _parCh.isInputs       & 0xFF);} //set INTerrupts ENable A
                            else				{aBus.writeByteSync(_parCh.addr, BNK1_GPINTEN_B, (_parCh.isInputs >> 8) & 0xFF);} //set INTerrupts ENable B
                           if (_bitNum < 8) 	{aBus.writeByteSync(_parCh.addr, BNK1_INTCON_A, 0x00);} //set INTerrupts CONtrol A to compare Input A to previous value
                           else				    {aBus.writeByteSync(_parCh.addr, BNK1_INTCON_B, 0x00);} //set INTerrupts CONtrol B to compare Input B to previous value
                        }
                    break;
                    case("MCP23008"):
                        // IOCON: bit 7 ignored:                              bit7         ->x
                        //        bit 6 ignored:                              bit6         ->x
                        //        disable address pointer auto-increment:     bit5 SEQOP   ->1
                        //        enable SDA slew rate control:               bit4 DISSLEW ->0
                        //        HAEN only relevant for SPI version of chip: bit3 HAEN    ->x
                        //        interrupt output as open drain:             bit2 ODR     ->1
                        //        if ODR, then INTPOL not relevant:           bit1 INTPOL  ->x (if ODR=0, then active high->1, active low->0)
                        //        bit 0 ignored:                              bit0         ->x
                        //        (11)100100 = 0xE4 (two MSBs ignored by MCP23008)
                        aBus.writeByteSync(_parCh.addr, BNK1_IOCON_A, 0xE4);// See:Page-8 TABLE 1-3 MCP23008 datasheet PDF

                        _processState = 2;

                        // Check if need to Turn On ALL pins at start
                        if ((_parCh.startAllHIGH == true) && (_callerNode.lastState = -2)){
                            if (log2console) console.log("  MCP23008 Now Setting ALL pins to HIGH. A = 1111111 Addr = 0X" + _parCh.addr.toString(16));
                            aBus.writeByteSync(_parCh.addr, BNK1_OLAT_A, 0xFF);	//Set output (A) to 11111111
                            _parCh.allStates 	= 0xFF; // 8 bit: (PortA) GPIO 0-7
                        }
                        if (_parCh.allStates = -1) {
                            ip1 = aBus.readByteSync(_parCh.addr, BNK1_GPIO_A); //read (Bank-A) GPIO pins
                            _parCh.lastTimeRead = performance.now();
                            _parCh.allStates = ip1;
                        }
                        if (log2console) console.log("    MCP23008 First READ OK; A="+ip1.toString(2).padStart(8,"0")+" allStates=" + _parCh.allStates.toString(2).padStart(8,"0"));
                    
                        // Set Registers
                        // _parCh.isInputs determines which pins are inputs (IODIR = 1) or outputs (IODIR = 0)
                        if (_isInput)	 {_parCh.isInputs = _parCh.isInputs |  (1 << _bitNum); }// input: e.g. if _bitNum = 5, shift 1 left 5, then bitwise or with whatever _parCh.isInputs is makes pin 5 an input
                        else			 {_parCh.isInputs = _parCh.isInputs & ~(1 << _bitNum); }//output: e.g. if _bitNum = 5, shift 1 left 5, then bitwise and (not bit5) with whatever _parCh.isInputs is makes pin 5 an output
                        aBus.writeByteSync(_parCh.addr, BNK1_IODIR_A,  _parCh.isInputs       & 0xFF); //update in/out ports(A)
                        
                        if (_isInput) {
                            if (_pullUp)  {_parCh.pullUps  = _parCh.pullUps  | (1 << _bitNum);} else {_parCh.pullUps  = _parCh.pullUps  & ~(1 << _bitNum);}
                            if (log2console) console.log("    MCP23008 Input pullups=" + _parCh.pullUps);
                            aBus.writeByteSync(_parCh.addr, BNK1_GPPU_A ,    _parCh.pullUps        & 0xFF); //set internal pull-up 100K resistor(A)
                            aBus.writeByteSync(_parCh.addr, BNK1_IPOL_A, 0x00); //disable Input invert(=POLarity) A
                            aBus.writeByteSync(_parCh.addr, BNK1_GPINTEN_A,  _parCh.isInputs       & 0xFF); //set INTerrupts ENable A
                            aBus.writeByteSync(_parCh.addr, BNK1_INTCON_A,  _parCh.isInputs       & 0xFF); //set INTerrupts CONtrol                                
                        }
                    break;
                    // END MCP chip
                }   

                _processState = 3;
                aBus.closeSync();
                aBus = null;

                if (log2console) console.log("    "+_parCh.chipType+" Bit-initialization finished. Bus closed.");
                _parCh.globalState = 1; // means: Working :)
                _callerNode.lastState = getBit( _parCh.allStates, _bitNum );  // SET LAST STATE
                return true;
            }
            catch (err) {
                if (_parCh.globalState < 60) _parCh.globalState += 2;  // The whole chip in error mode, because the Bus could not be opened
                _callerNode.lastState = -2;
                _callerNode.error( busStateTexts[_processState] + " failed. Bus=" + _parCh.busNum + " Pin=" + _bitNum + "\n  Error:" + err);
                showStatus( _callerNode, false, _parCh.globalState );
                aBus = null;
                return false;
            }
        }
        /*   ### END INITIALIZATION of the Chip ###   */

        // ********** TIMER ********** // ... for input polling
        // *************************** //
        this.startChipTimer = function(_newInterval) {
            if (log2console) console.log("    "+this.chipType+" startChipTimer = " + _newInterval +" ms");
            
            if ((_newInterval == undefined) || (_newInterval == 0)) {
                console.log("    "+this.chipType+"  Timer interval is UNDEFINED or 0 ! Timer will not be started, old may be cleared. Exiting Timer.");
                if (mainChipNode.chipTimer) clearInterval(mainChipNode.chipTimer);
                return null;
            }

            if (mainChipNode.chipTimer != null) { // timer is already running
                if (log2console) console.log("  MCP/PCF Timer is already running");
                if (mainChipNode.interval == _newInterval) {
                    if (log2console) console.log("  MCP/PCF This timer interval is already set. There is nothing to do.");
                    return null;
                } // nothing to do
                clearInterval(mainChipNode.chipTimer); // clear old, so a new can be started
                mainChipNode.interval = _newInterval;
                mainChipNode.chipTimer = null;
                if (log2console) console.log("  MCP/PCF Old timer destroyed.");
            }

            // STARTING a Timer in repeat mode
            if (log2console) console.log("  MCP/PCF Starting Timer now...");				
            mainChipNode.chipTimer = setInterval(mainChipNode.reviewStates, mainChipNode.interval);
        }

        this.reviewStates = function(read1x,interrupt) { //used to be called myTimer
            let   _processState = 0;
            const _chipType = mainChipNode.chipType;
            const _addr = mainChipNode.addr;

            if (isNaN(mainChipNode.busNum))     { //<<< ab1do: may not need anymore: NaN is detected at design stage
                console.error("  MCP/PCF  chip reviewStates busNum is undefined. Exiting.");
                mainChipNode.globalState += 2;
                return false;
            }

            const _readTime	= performance.now(); // millisec. To change the Timer value, if too short a period is set.
            try {
                if (timerLog && log2console) console.log("  MCP/PCF reviewStates: opening bus...  Time: " + new Date( new Date().getTime() ).toISOString().slice(11, -1) );

                let _aBus = i2cModule.openSync(mainChipNode.busNum);
                _processState = 1;
                let ipAll = -1;
                let ipA=-1, ipB=-1;

               switch(_chipType) {
                    case ("PCF8574"): case("PCF8574A"):
                        if (timerLog && log2console) console.log("  PCF8574(A) >> Now reading 8bits. Addr = 0X" + _addr.toString(16));
                        ipAll = _aBus.receiveByteSync(_addr);
                        if (timerLog && log2console) console.log("  PCF8574(A) Read success ipAll00=" + ipAll.toString(2).padStart(8,"0"));
                    break;
                    /**** Using readWordSync: needs chip address and cmd. Because PCF8575 has no registers to read from, cmd = chip address.*/
                    case ("PCF8575"):
                        if (timerLog && log2console) console.log("  PCF8575 >> Now reading 16bits. Addr = 0X" + _addr.toString(16));
                            ipAll =  _aBus.readWordSync(_addr,_addr);// LSB followed by MSB
                        if (timerLog && log2console) console.log("  PCF8575 Read success ipAll00=" + ipAll.toString(2).padStart(16,"0"));
                    break;
                    case ("MCP23017"):
                        if (timerLog && log2console) console.log("MCP23017 >> Now reading A+B banks... Typeof _aBUS:" + typeof(_aBus));
                        ipA = _aBus.readByteSync(_addr, BNK1_GPIO_A);
                        ipB = _aBus.readByteSync(_addr, BNK1_GPIO_B);
                        ipAll = ipA + (ipB << 8);
                        console.log("MCP23017 Read success ipA00=" + ipA.toString(2).padStart(8,"0") + "  ipB00=" + ipB.toString(2).padStart(8,"0") + "   ipALL =" + ipAll.toString(2).padStart(16,"0"));
                        if (timerLog && log2console) console.log("MCP23017 Read success ipA00=" + ipA.toString(2).padStart(8,"0") + "  ipB00=" + ipB.toString(2).padStart(8,"0") + "   ipALL =" + ipAll.toString(2).padStart(16,"0"));
                    break;
                    case ("MCP23008"):
                        if (timerLog && log2console) console.log("MCP23008 >> Now reading 8Bits... Typeof _aBUS:" + typeof(_aBus));
                        ipAll = _aBus.readByteSync(_addr, BNK1_GPIO_A);
                        if (timerLog && log2console) console.log("MCP23008 Read success ipA00=" + ipA.toString(2).padStart(8,"0") + "   ipALL = " + ipAll.toString(2).padStart(8,"0"));
                    break;
                }

                _processState = 3;
                _aBus.closeSync();

                if (mainChipNode.globalState != 1) {
                    mainChipNode.globalState = 1; // successful read occured. No more "error state" or "uninitialised"
                    if (mainChipNode.interval != mainChipNode.origInterv) { 
                        if (timerLog && log2console) console.log("  MCP/PCF Starting ChipTimer. Interval=" + mainChipNode.origInterv);
                        mainChipNode.startChipTimer( mainChipNode.origInterv ); // this will delete the old timer and start normally again
                    }
                }

                // *********  Now checking ALL the possible nodes, to see if any of these needs to be updated
                if (ipAll != mainChipNode.allStates){
                    let diffWord = ipAll ^ mainChipNode.allStates; // bitwise XOR operator
                    if (log2console) console.log(_chipType + "  > Existing States:                "+ipAll.toString(2).padStart( mainChipNode.maxBits,"0"));
                    if (log2console) console.log(_chipType + "  > New States:                     "+mainChipNode.allStates.toString(2).padStart(mainChipNode.maxBits,"0"));
                    if (log2console) console.log(_chipType + "  >!Change! of an input: Diff Mask= "+diffWord.toString(2).padStart( mainChipNode.maxBits,"0"));
                    for (let i=0; i < mainChipNode.maxBits; i++){	// (maxBits= 8 or 16)
                        if (diffWord & (1 << i)){
                            const newState =  (((ipAll & (1 << i)) == 0) ? false : true); 
                            if ( mainChipNode.ids[i] != null)  {
                                const n = RED.nodes.getNode(mainChipNode.ids[i]);
                                if (n != null) {// && (mainChipNode.isInputs & (1 << i) == 0)) { // check bit is used and is not an input
                                    n.changed(newState, read1x,interrupt);
                                }
                            }
                        }
                    }
                    mainChipNode.allStates = ipAll;
                }	
            }
            catch (err) {
                if (mainChipNode.globalState < 63) mainChipNode.globalState += 2;  // The whole chip in error mode, because the Bus could not be opened. Increasing next time-read to 2-4-6-..-60 sec.
                err.discription = busStateTexts[_processState] + " failed.";
                err.busNumber   = mainChipNode.busNum;
                err.address     = _addr;
                err.allStates = mainChipNode.allStates;
                console.error(err.discription + "  [Bus="+ mainChipNode.busNum +"]  [Addr = 0X" + _addr.toString(16) + "]   [mainChipNode.allStates=" + mainChipNode.allStates + "]");
                mainChipNode.error(err);

                try {
                    // update ALL nodes, so they show "error"
                    for (var i=0; i < mainChipNode.maxBits; i++) { //(maxBits= 8 or 16)
                        if ( mainChipNode.ids[i] != null) {
                            const n = RED.nodes.getNode(mainChipNode.ids[i]);
                            if (n != null) { 
                                showStatus(n, -2, mainChipNode.globalState);
                            }
                        }
                    }
                    if ((_processState < 3) && !read1x)  { // if !read1x = called from debounce ... it should not restart
                        mainChipNode.startChipTimer( mainChipNode.globalState * 1000 ); // re-try every 2-4-6-...60 sec.
                    } 
                }
                catch (err){ 
                    console.error(err);
                }
                return false;
            }

            mainChipNode.lastTimeRead = performance.now(); //new Date().getTime();
            mainChipNode.readLength  = mainChipNode.lastTimeRead - _readTime;
            if (! read1x) { // if "continuous read" is happening now
                if (mainChipNode.interval < mainChipNode.readLength) {  // the time the reading took was too long. Increased the interval to double of that (ms).		
                    mainChipNode.warn("  MCP/PCF Interval (" + mainChipNode.interval + "ms) is too short for input. Setting new time = " + (mainChipNode.readLength * 2).toString());
                    mainChipNode.startChipTimer( Math.trunc(mainChipNode.readLength * 2)); // double the waiting period
                } else 
                if ((mainChipNode.origInterv != mainChipNode.interval) && (mainChipNode.readLength < mainChipNode.origInterv)) {
                    mainChipNode.startChipTimer( mainChipNode.origInterv ); // set back original interval
                }
            }
            return true;
        }

        this.on('close', function() {  // stopping or deleting the Main-Chip-config
            try {
                if (mainChipNode.chipTimer) {
                    if (log2console) console.log("  MCP/PCF Closing ... Clearing chipTimer.");
                    clearInterval(mainChipNode.chipTimer);
                    mainChipNode.chipTimer = null; 
                }
            }
            catch (err) {console.error( "  MCP/PCF Error while closing timer: " + err );}
            try {
                global_i2c_bus_RW_ctx.set(_i2c_ctx_name, undefined); // clearing global context
            } catch {}
        });
    }

    // REGISTERING the main chip : 
    RED.nodes.registerType("mcp pcf chip", mcp_pcf_chipNode);

    //INPUT SECTION
    function mcp_pcf_inNode(_inputConfig) {
        RED.nodes.createNode(this, _inputConfig);
        
        var node        = this;
        this.bitNum     = _inputConfig.bitNum;
        this.pullUp     = _inputConfig.pullUp;
        this.invert     = _inputConfig.invert;
        this.debounce   = _inputConfig.debounce;
        this.deB_timer  = null;
        this.onMsg 	    = _inputConfig.onMsg;
        this.offMsg     = _inputConfig.offMsg;
        this.diagnostics= _inputConfig.diagnostics
        this.lastState  = -2;
        this.initOK     = false;

        // check Master-Chip setup
        let _parentChipNode = RED.nodes.getNode(_inputConfig.chip);
        this.parentChip		= _parentChipNode;
        let _parCh = node.parentChip;
        if (!_parentChipNode) {
            node.error("[MCP230XX + PCF857X] Master-global-Chip not found! Skipping input-node creation.");
            showStatus(node, true, 0);
            return null;
        }
        if(log2console) console.log(">>>> DEBOUNCE = "+this.debounce+" ms and _parentChipNode.interval = "+_parentChipNode.interval+" ms");
        
        if (log2console) console.log("---");		
        if (log2console) console.log(">>> Initializing "+_parCh.chipType+"  Input node >>  bitNum=" + this.bitNum + "  pullUp=" + this.pullUp + "  invert=" + this.invert + "  id=" + this.id );

        this.initOK  = _parentChipNode.initializeBit (this.bitNum, true, this.pullUp, node);// this.pullUp ignored for PCF chips
        showStatus(node, this.lastState, _parentChipNode.globalState); // shows uninit (yellow) or error (red) 

        this.on('close', function() {
            if (node.deB_timer != null){
                if (log2console) console.log("  MCP/PCF  > clearing old Debounce Input timer...  [Pin=" + node.bitNum + "]");
                clearTimeout(node.deB_timer);
                node.deB_timer = null;
            }
        });

        this.updateState = function(_state, _msg, _interrupt) {
            if (node.lastState != _state) {
                if (log2console) console.log(_parCh.chipType + "  > Pin " + node.bitNum + " changed from "+node.lastState+" to " + _state + ";  id=" + node.id);
                showStatus(node, _state, _parentChipNode.globalState); // will show inverted status, if needed
                node.lastState  = _state;
            }
            if (_parentChipNode.globalState == 1){
                const nullmsg = (_msg == null);
                if (nullmsg) _msg = {};
                const _stateINV = node.invert ? !_state : _state;
                if (  _stateINV && node.onMsg ) _msg.payload = true;
                if (! _stateINV && node.offMsg) _msg.payload = false;
                _msg.interrupt =  _interrupt;
                if (nullmsg && (_msg.payload != null)) {node.send( _msg )}  else return _msg; // if called from "read_1x" input >> do not send yet
            }
        }

        this.changed = function( _state, _read1x, _interrupt ) {
            if (node.deB_timer != null){
                if (log2console) console.log("  MCP/PCF > clearing old Debounce Input timer...  [Pin=" + node.bitNum + "]");
                clearTimeout(node.deB_timer);
                node.deB_timer = null;
            }
            if (!_read1x && (node.debounce != 0) && (_parentChipNode.globalState == 1) && ((_state == true) || (_state == false))) {
                // Start debounce re-checks the last state
                node.deB_state = _state;
                node.deB_timer = setTimeout(node.deBounceEnd, node.debounce, _state);
                if (log2console) console.log("  MCP/PCF > New input Debounce timer set.  TimeEnd=" + node.debounce + "  State=" + _state);
            }
            else {
                node.updateState(_state, null, _interrupt);
                node.deB_state = _state;
            }
        }

        this.deBounceEnd = function(_state){
            node.deB_timer = null;
            if (_parentChipNode.globalState > 3) {
                if (log2console) console.log("  MCP/PCF > Input timer deBounce CANCELED because chip is in Global-Error-State" );
                return false;
            }
            let _now = performance.now();
            if ((_now - node.lastTimeRead) < node.debounce) { //changed node.debounce*1.2 to node.debounce
                _state = getBit( _parentChipNode.allStates, node.bitNum );
                node.updateState(_state, null, false);
                if(log2console) console.log("updateState called from this.deBounceEnd");
            }
            else {
                let _read_success = _parentChipNode.reviewStates(true,false); // forcing to re-read the current state from chip	
                if ( _read_success ) {
                    _state = getBit( _parentChipNode.allStates, node.bitNum );
                    if (log2console) console.log("  MCP/PCF > Input timer Bounce Ended. [NewState=" + _state + "]   [Last State=" + node.lastState + "]  [Deb.state=" + node.deB_state +"]  [Bit=" + node.bitNum + "]  Ellapsed=" + (_now - node.lastTimeRead) + "ms" );
                    if (_state == node.deB_state) node.updateState(_state, null, false);
                }
                else {node.deB_timer = setTimeout(node.deBounceEnd, node.debounce, _state);}
            }
        }

        this.on('input', function(msg, send, done) { // triggers an immediate read if payload is False or 0 >> to support Interrupts
                                                     // Changed to active low to comply with PCF active low as well as MCP ODR active low  
            if (!msg.payload) {// interrupt activated when 0 or false
                let _parCh = node.parentChip;
                send = node.diagnostics;// true if checked, false if not checked;
                if (msg.payload===0)     {if (log2console) console.log(_parCh.chipType+"  > Interrupt detected! Reading Input");}
                if (msg.payload===false) {if (log2console) console.log(_parCh.chipType+"  > Read Now detected:  Reading Input");}
                let readSuccess =  _parCh.reviewStates(true,true); // result is True, if succesfully read, false if any error occured during read; sends msg on input change
                if(send) { //Send a msg with diagnostic data
                    msg.readSuccess = readSuccess; // result is True, if succesfully read, false if any error occured during read
                    msg.readTime	= _parCh.readLength;
                    msg.allStates	= msg.readSuccess  ? _parCh.allStates.toString(2).padStart(_parCh.maxBits,"0") : "";
                    msg = node.updateState( node.lastState, msg, true ); // << this will add (inverted) .payload                
                    node.send(msg); // this msg includes msg.topic = gpio/#, where # is the GPIO port number that interrupt is connected to
                }
                if (done) done();
            }
        });

        this.on('close', function() {  // stopping or deleting this node
            let _parCh = node.parentChip;
            try {
                for (let i=0; i < _parCh.maxBits; i++) {	//(maxBits= 8 or 16)
                    if ( _parCh.ids[i] == node.id) {
                        _parCh.ids[i] = null;
                        break;
                    }
                }
            }
            catch (err) {console.error( "  "+_parCh.chipType+"  Error while closing an Input-Node: " + err );}
        });

        if (this.initOK) {_parentChipNode.startChipTimer(_parentChipNode.interval);}// START continuous read, if any input nodes are available
        else { }
    }

    RED.nodes.registerType("mcp pcf in", mcp_pcf_inNode);

    //OUTPUT SECTION
    function mcp_pcf_outNode(_OutputConfig) {
        RED.nodes.createNode(this, _OutputConfig);

        var node 		  = this;
        node.bitNum       = _OutputConfig.bitNum;
        node.invert       = _OutputConfig.invert;
        node.legacy       = _OutputConfig.legacy;
        node.lastState	  = -2;
        node.initOK       = false;
        
        // check Master-Chip setup
        let _parentChipNode = RED.nodes.getNode(_OutputConfig.chip); //  hidden Chip-configuration node
        node.parentChip		= _parentChipNode;
        if (!_parentChipNode) {
            node.error("Master MCP230XX or PCF857X Chip not set! Skipping node creation. Node.id=" + node.id);
            showStatus(node, -2, 2);
            return null;
        }
        node.startAllHIGH = _parentChipNode.startAllHIGH;

        if (log2console) console.log("---");
        console.log(">>> Initializing  "+_parentChipNode.chipType+" Output node >>  invert=" + node.invert + " pinNum=" + node.bitNum + "  ID=" + node.id);

        this.initOK  = _parentChipNode.initializeBit(node.bitNum, false, false, node);
        showStatus(node, this.lastState, _parentChipNode.globalState); // shows uninitialized (yellow) or error (red)

        this.changed = function( _state, _read1x ) {
            showStatus(node, _state, _parentChipNode.globalState); // will show inverted, if needed
            node.lastState = _state;
        }

        this.setOutput = function(_bitNum, _newState, _callerNode){
            let _processState = 0;
            if ( ! _callerNode) {     console.error( _chipType + "setOutput >> _callerNode=null !"); return false; }
            let _parCh = _callerNode.parentChip;
            if ( ! _parCh)		{ _callerNode.error( _chipType + "setOutput >> _callerNode.parentChip=null !"); return false; }
            const _addr = _parCh.addr;
            if ( ! _addr)		{ _callerNode.error( _chipType + "setOutput >> parentChip.addr=null !"); return false; }
            const _chipType = _parCh.chipType;

            try {
                let ip8  = -1;
                let ip16 = -1; 
                if (log2console) console.log(_chipType +" setOutput "+ _callerNode.id +"  > Addr = 0X" + _addr.toString(16) + "  PinNum=" + _bitNum + " _newState:" + _newState +" > opening bus...");
                let _aBus = i2cModule.openSync(_parCh.busNum);
                _processState = 1;

                // Set ALL output pins to 0 or 1-> msg.topic = all, msg.payload = true/false
                if (_bitNum == -1) {
                    let on_off = _newState? 0xFFFF : 0x0000;
                    switch(_chipType) {
                        case("PCF8574"): case("PCF8574A"):
                            on_off = on_off | _parCh.isInputs; // bitwise OR allStates of chip with isInputs to change only output nodes
                            _aBus.sendByteSync (_addr, on_off & 0xFF);
                            _parCh.reviewStates(true,false);
                            _parCh.lastTimeRead = performance.now();
                        break;
                        case("PCF8575"):
                            on_off = on_off | _parCh.isInputs; // change only output nodes
                            _aBus.writeWordSync(_addr,on_off & 0xFF,(on_off>>8) & 0xFF);//set pins 0-7 and 8-15;
                            _parCh.reviewStates(true,false);
                            _parCh.lastTimeRead = performance.now();
                        break;
                        case("MCP23017"):
                            _aBus.writeByteSync(_addr, BNK1_OLAT_A, on_off & 0xFF);	//Set output A, has no effect on Pins configured as inputs
                            _aBus.writeByteSync(_addr, BNK1_OLAT_B, on_off & 0xFF);	//Set output B, has no effect on Pins configured as inputs
                            _parCh.lastTimeRead = performance.now();
                           _parCh.allStates = on_off;
                        break;
                        case("MCP23008"):
                            _aBus.writeByteSync(_addr, BNK1_OLAT_A, on_off & 0xFF);	//Set output, has no effect on Pins configured as inputs
                            _parCh.lastTimeRead = performance.now();
                            _parCh.allStates = on_off & 0xFF;
                        break;
                    }
                    for (let i=0; i < _parCh.maxBits; i++){	//maxBits = 8 or 16
                        if (_parCh.ids[i] != null)  {
                            const n = RED.nodes.getNode(_parCh.ids[i]);
                            if (log2console) {console.log(_chipType+" isInputs = "+_parCh.isInputs.toString(2).padStart(16,"0"))}
                            if (n != null && getBit(_parCh.isInputs,i)==0) { //ONLY UPDATE STATES of OUTPUT NODES
                                showStatus( n, _newState, _parCh.globalState);
                                n.lastState = _newState; 
                            }
                        }
                    }					
                }
                // Set only one pin to: 0 or 1 -> (msg.topic = any AND msg.pin = pin#) OR (msg.topic != all AND != any); msg.payload = true/false
                else {
                    // first read the current state of LSB or Bank A (takes 4ms)
                    if (_bitNum < 8) {
                        switch(_chipType){
                            case("PCF8574"): case("PCF8574A"): 
                                ip8 = _aBus.receiveByteSync(_addr); 
                            break;
                            case("MCP23008"): case("MCP23017"): 
                                ip8 = _aBus.readByteSync(_addr, BNK1_GPIO_A);//MCP23017: LSB
                            break;
                            case("PCF8575"): 
                                ip16 =_aBus.readWordSync(_addr,_addr); 
                            break; //PCF8575 always reads 2 bytes (=1 word) so only ip16 is relevant
                        }    
                        if (_chipType != "PCF8575") {ip16 = ip8;}//PCF8575 ip16 already completely known; MCP23017 ip8 is LSB of ip16
                    } else {// _bitNum>=8
                        switch(_chipType){
                            case("PCF8575"): 
                                ip16 =_aBus.readWordSync(_addr,_addr); 
                            break;
                            case("MCP23017"):
                                ip8 = _aBus.readByteSync(_addr, BNK1_GPIO_B);//MSB
                                ip16 = (ip8 << 8); //move ip8 to ip16 MSB position
                            break;
                        }
                    }
                    _parCh.lastTimeRead = performance.now();
                    if (log2console) {
                        if(_chipType == "MCP23017" || _chipType == "PCF8575") {
                            console.log("    Read before write success ip16="+ip16.toString(2).padStart(16,"0"));
                        } else{
                            console.log("    Read before write success ip8="+ip8.toString(2).padStart(8,"0"));
                        }
                    }
                    ip16 = updateBit(ip16, _bitNum, _newState); //16 bit
                    if (log2console) {
                        if(_chipType == "MCP23017" || _chipType == "PCF8575") {
                            console.log("    Updated pin ip16="+ ip16.toString(2).padStart(16,"0"));
                        } else{
                            console.log("    Updated pin ip8="+ ip16.toString(2).padStart(8,"0"));
                        }
                    }

                    _processState = 2;
                    switch (_chipType) {
                        case("PCF8574"): case("PCF8574A"):
                            ip16 = ip16 | _parCh.isInputs;
                            _aBus.sendByteSync(_addr, ip16 & 0xFF); // write LSB only
                        break;
                        case("PCF8575"):
                            ip16 = ip16 | _parCh.isInputs;
                            _aBus.writeWordSync(_addr,ip16 & 0xFF,(ip16>>8) & 0xFF); // write LSB followed by MSB
                        break; 
                        case("MCP23008"):
                            _aBus.writeByteSync(_addr, BNK1_OLAT_A, ip16 & 0xFF); // write LSB only
                        break;
                        case("MCP23017"):
                            if (_bitNum < 8) {_aBus.writeByteSync(_addr, BNK1_OLAT_A, ip16 & 0xFF);}	  //Set output A = LSB
                            else		     {_aBus.writeByteSync(_addr, BNK1_OLAT_B,(ip16 >> 8) & 0xFF);}//Set output B = MSB
                        break;
                    }
                }

                _processState = 3;
                _aBus.closeSync();
                _aBus = null;
                _parCh.globalState = 1; // working

                let n = _callerNode;
                if ( n.bitNum != _bitNum ) { // if msg.topic = any AND msg.pin = pin# change the status of the corresponding node if exists
                    for (let i=0; i < _parCh.maxBits; i++){	//maxBits= 8 or 16
                        if (( _parCh.ids[i] != null) && (i==_bitNum))  {
                            n = RED.nodes.getNode(_parCh.ids[i]);
                            if (n != null && getBit(_parCh.isInputs,i)==0) {
                                showStatus( n , _newState, 1);
                                n.lastState = _newState; 
                            }
                        }
                    }
                } else { // Output was set using "pin-control mode", setting single node to on/off
                    if (n != null) 	showStatus(n, _newState, 1);
                }
                if (log2console) console.log(":-) "+_parCh.chipType+" setOutput finished. Closing bus. ip1="+ ip16);
                return true;
            }
            catch (err) {
                if (_parCh.globalState < 60) _parCh.globalState += 2;  // The whole chip in error mode, because the Bus could not be opened
                _callerNode.lastState = -2;
                showStatus(_callerNode, -2, 2);
                let _ee = busStateTexts[_processState] + " failed. Bus="+ _parCh.busNum +" Addr = 0X" + _addr.toString(16) + " Pin="+_bitNum + " NewState=" + _newState;
                console.error(_ee + " " + err);
                _callerNode.error([_ee, err]);
                _aBus = null;
                return false;
            };
        }

        this.on('input', function(msg) {
            let _parCh = node.parentChip;
            if (!node.initOK) {
                if (log2console) console.log("  MCP/PCF Out > New msg recieved, but Node not initialized yet. ID=" + node.id + "  bitNum=" + node.bitNum);
                node.initOK = _parCh.initializeBit(node.bitNum, false, false, this.id);
                if (!node.initOK) {return null;}
            }

            if (! _parCh) { console.error("  MCP PCF Out >> input msg recieved, but ParentChip of Node is null!"); return null }
            const _chipType = _parCh.chipType;

            // ***  SET any pin using chip-control mode  *** //
            if(node.legacy) { //legacy mode: transcribe legacy message structure to new message structure
                if (msg.payload == -1) {
                    msg.topic = "any";
                    msg.payload = msg.state;
                }
                if (msg.payload == "all1") {
                    msg.topic = "all";
                    msg.payload = true;
                }
                if (msg.payload == "all0") {
                    msg.topic = "all";
                    msg.payload = false;
                }
            }
            if (msg.topic == "any") {
                if (log2console) console.log(_chipType + " > Chip-control mode. Chip Addr=0X" + _parCh.addr.toString(16));
                if (msg.payload == null) {
                    node.error("msg.payload not set for chip-control of a MCP or PCF chip: must be true(1) or false(0)");
                    return false;
                }
                let _OnOff1 = (msg.payload == true) || (msg.payload == 1); //safe boolean conversion
               
                let n = node;

                //pins is an array holding all pins to be switched. If msg.pin is a number, pins will be an array of length 1 holding that number.
                //If msg.pin is an array, pins equals msg.pin
                let pins = [];
                if(msg.pin == null || msg.pin == undefined) {
                    node.error("msg.pin is null/undefined: must be a number or array of numbers between 0-7 or 0-15");
                    return false;
                } else if(msg.pin.length == undefined) { //allows for backwards compatibility where msg.pin is a single number and not an array
                    pins.push(msg.pin);
                } else { //msg.pin is an array
                    pins = msg.pin;
                }
           
                for(let j = 0; j < pins.length; j++){
                    let _bitNum = parseInt(pins[j]);
                    if ((_bitNum == NaN) || (_bitNum < 0) || (_bitNum > _parCh.maxbits)) {
                        node.error("msg.pin not properly set for chip-control of a MCP or PCF chip: must be a number or array of numbers between 0-7 or 0-15");
                        return false;
                    }
                    let inverse = node.invert; //invert determined by node the message was sent to
                    if (n.bitNum != _bitNum) { //if msg.topic = any AND msg.pin = pin#
                        for (let i=0; i < _parCh.maxBits; i++){	//maxBits= 8 or 16
                            if (( _parCh.ids[i] != null) && (i==_bitNum))  {
                                n = RED.nodes.getNode(_parCh.ids[i]);
                                if (n != null) {// pin# output node is on deck
                                    inverse = n.invert; //invert determined by the node connected to pin#
                                }
                            }
                        }
                    }
                    let _invOnOff1 = inverse? !_OnOff1 : _OnOff1;
                    node.setOutput(_bitNum, _invOnOff1, node);
                }
            } else

            // ***  SET all pins to 0 or 1  *** //
            if (msg.topic == "all") {
                if (msg.payload == false || msg.payload == 0) {
                    if (log2console) console.log(_chipType + " > Set ALL pins to 0000...  Chip Addr=0X" + _parCh.addr.toString(16));
                    node.setOutput(-1, false, node);
                } else if ( msg.payload == true || msg.payload == 1) {
                    if (log2console) console.log(_chipType + " > Set ALL pins to 1111...  Chip Addr=0X" + _parCh.addr.toString(16));
                    node.setOutput(-1, true, node);
                }
            } else {  // ***  SET only 1 pin using pin-control mode  *** //
                if (msg.payload == -1 || msg.payload == "all1" || msg.payload == "all0") return null; //stop legacy messages from setting _pinOn to false in non-legacy mode
                let _pinOn = (msg.payload === true) || (msg.payload === 1); //safe boolean conversion
                let _invPinOn = node.invert ? !_pinOn : _pinOn;
                if (log2console) console.log("PinOn = "+_pinOn+"; invPinOn = "+_invPinOn); 
                if (node.setOutput(node.bitNum, _invPinOn, node)) {//sets output pin and returns true if all OK
                    node.lastState = _invPinOn;
                }
            }			
        });
        
        this.on('close', function() {  // stopping or deleting this node
            let _parCh = node.parentChip;
            try {
                for (let i=0; i < _parCh.maxBits; i++){	//(maxBits= 8 or 16)
                    if ( _parCh.ids[i] == node.id)  {
                        _parCh.ids[i] = null;
                        break;
                    }
                }
            }
            catch (err) { console.error( "  MCP/PCF Error while closing an Out-Node: " + err ); };
        });
    }
    
    RED.nodes.registerType("mcp pcf out", mcp_pcf_outNode);
    
    //GET LIST of I2C BUSES
    //i2cBusList resolves to an array of 'valid' i2c bus numbers; buses array includes bus numbers
    //excluding inaccessible buses i2c-20 & 21 on Raspberry Pi 4. 
    //The list may still include reserved buses, e.g. it may include i2c-0, which on many RPis
    //is reserved for HAT EEPROMS, i2c-2 which on older RPis is reserved for onboard camera, etc. 
    //It is left up to the user to make sure that only a valid/accessible bus is selected.
    const i2cBusList = new Promise((resolve,reject) => {
        var i2cbuses = spawnSync('i2cdetect', ['-l'], { encoding: 'utf-8' });
        if (i2cbuses.stderr && i2cbuses.stderr !=="") {
            reject("An error occurred while searching for i2c-buses");
        } else {
            i2cbuses = i2cbuses.stdout.toString().trim().match(/i2c-\d*/g); //<only get i2c bus name
            var labels = i2cbuses.filter(x => !(i2cbuses.filter(ele => ele.match(/2\d/g))).includes(x)).sort(); //<remove i2c-20 & i2c-21
        
            //change labels from i2c-n to /dev/i2c-n
            for (let i=0; i < labels.length; i++) {
                labels[i] = '/dev/'+labels[i];
            }
            var values = labels.map(x => x.match(/\d+$/)[0]);
            var buses = []; 
            for (let i = 0; i < values.length; i++) {
                var myObject={};
                myObject["label"] = labels[i];
                myObject["value"] = values[i];
                buses[i]=myObject;
            }
            resolve(buses);
        }
    });

    RED.httpAdmin.get("/mcp-pcf-aio", function(req,res) {
        i2cBusList.then(buses => {
            res.json(buses);
        });
    });
}
