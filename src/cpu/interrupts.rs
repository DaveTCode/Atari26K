use crate::ClockCycle;

#[allow(non_camel_case_types)]
#[derive(Debug, Copy, Clone)]
pub enum Interrupt {
    NMI(ClockCycle),
    IRQ(ClockCycle),
    IRQ_BRK(ClockCycle),
    RESET(ClockCycle),
}

impl Interrupt {
    pub(super) fn offset(&self) -> u16 {
        match self {
            Interrupt::NMI(_) => 0xFFFA,
            Interrupt::IRQ(_) => 0xFFFE,
            Interrupt::IRQ_BRK(_) => 0xFFFE,
            Interrupt::RESET(_) => 0xFFFC,
        }
    }
}
